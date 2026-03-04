// background.js — Service Worker (MV3)
// Решение проблемы засыпания SW: chrome.alarms каждые 6 сек + поллим при пробуждении

import { generateBrowserId, getSettings, saveSettings } from './utils.js';
import { executeCommand } from './executor.js';

const ALARM_NAME = 'brc_keepalive';

// ─── Лог с временной меткой ───────────────────────────────────────────────────

function log( level, ...args ) {
  const ts = new Date().toISOString().replace('T',' ').slice(0,19);
  const prefix = `[BRC ${ts}]`;
  if      ( level === 'error' ) console.error( prefix, ...args );
  else if ( level === 'warn'  ) console.warn(  prefix, ...args );
  else                          console.log(   prefix, ...args );
}

// ─── Держать SW живым ─────────────────────────────────────────────────────────

function keepAlive() {
  chrome.alarms.get( ALARM_NAME, ( alarm ) => {
    if ( ! alarm ) {
      chrome.alarms.create( ALARM_NAME, { periodInMinutes: 0.1 } ); // ~6 сек
      log( 'info', 'Keep-alive alarm created' );
    }
  } );
}

chrome.alarms.onAlarm.addListener( ( alarm ) => {
  if ( alarm.name === ALARM_NAME ) {
    pollCommands();
  }
} );

// ─── Install / Startup ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener( async () => {
  log( 'info', '=== Extension installed ===' );
  const settings = await getSettings();
  if ( ! settings.browserId ) {
    const newId = generateBrowserId();
    await saveSettings({ ...settings, browserId: newId });
    log( 'info', 'Generated Browser ID:', newId );
  } else {
    log( 'info', 'Browser ID:', settings.browserId );
  }
  keepAlive();
  await autoRegisterIfNeeded();
  pollCommands();
} );

chrome.runtime.onStartup.addListener( async () => {
  log( 'info', '=== Browser started ===' );
  keepAlive();
  await autoRegisterIfNeeded();
  pollCommands();
} );

// ─── Авторегистрация ──────────────────────────────────────────────────────────

async function autoRegisterIfNeeded() {
  const settings = await getSettings();
  const { serverUrl, apiKey, browserId } = settings;
  if ( ! serverUrl || ! apiKey || ! browserId ) return;

  log( 'info', 'Auto-registering...' );
  try {
    const url = serverUrl.replace( /\/$/, '' ) + '/wp-json/brc/v1/register';
    const res = await fetch( url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:    apiKey,
        browser_id: browserId,
        label:      settings.browserLabel || 'My Browser',
      }),
    } );
    const data = await res.json();
    if ( res.ok ) {
      await saveSettings({ ...settings, registered: true });
      log( 'info', 'Auto-register OK:', data.status );
    } else {
      log( 'warn', 'Auto-register failed:', data.message );
    }
  } catch ( e ) {
    log( 'error', 'Auto-register error:', e.message );
  }
}

// ─── Message bridge (popup ↔ background) ─────────────────────────────────────

chrome.runtime.onMessage.addListener( ( msg, _sender, sendResponse ) => {
  if ( msg.action === 'register' ) {
    registerBrowser()
      .then( sendResponse )
      .catch( e => sendResponse({ ok: false, error: e.message }) );
    return true;
  }
  if ( msg.action === 'poll_now' ) {
    pollCommands()
      .then( () => sendResponse({ ok: true }) )
      .catch( e => sendResponse({ ok: false, error: e.message }) );
    return true;
  }
  if ( msg.action === 'get_settings' ) {
    getSettings().then( sendResponse );
    return true;
  }
} );

// ─── Registration ─────────────────────────────────────────────────────────────

async function registerBrowser() {
  const settings = await getSettings();
  const { serverUrl, apiKey, browserId, browserLabel } = settings;

  if ( ! serverUrl || ! apiKey || ! browserId ) {
    throw new Error( 'serverUrl, apiKey and browserId are required.' );
  }

  const url = serverUrl.replace( /\/$/, '' ) + '/wp-json/brc/v1/register';
  const res = await fetch( url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, browser_id: browserId, label: browserLabel || 'My Browser' }),
  } );

  const data = await res.json();
  log( 'info', 'Register HTTP', res.status, JSON.stringify( data ) );
  if ( ! res.ok ) throw new Error( data.message || 'Registration failed' );

  await saveSettings({ ...settings, registered: true });
  keepAlive();
  pollCommands();
  return { ok: true, data };
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

async function pollCommands() {
  const settings = await getSettings();
  const { serverUrl, apiKey, browserId, registered } = settings;

  if ( ! serverUrl || ! apiKey || ! browserId || ! registered ) return;

  const url = `${serverUrl.replace(/\/$/, '')}/wp-json/brc/v1/poll`
    + `?api_key=${encodeURIComponent(apiKey)}&browser_id=${encodeURIComponent(browserId)}`;

  let data;
  try {
    const res = await fetch( url );
    if ( ! res.ok ) { log( 'error', 'Poll error:', res.status ); return; }
    data = await res.json();
  } catch ( e ) {
    log( 'error', 'Poll network error:', e.message );
    return;
  }

  const commands = data.commands || [];
  if ( commands.length > 0 ) {
    log( 'info', `Got ${commands.length} command(s)` );
  }

  for ( const item of commands ) {
    log( 'info', `→ Command #${item.id} type="${item.command.type}"` );
    await dispatchCommand( item, settings );
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function dispatchCommand( item, settings ) {
  const { id, command } = item;
  const { serverUrl, apiKey, browserId } = settings;

  let status = 'executed';
  let result = '';

  try {
    // analyze_image не требует конкретного таба — обрабатывается внутри executor
    if ( command.type === 'analyze_image' ) {
      log( 'info', `  analyze_image — processing via AI Studio` );
      result = await executeCommand( null, command, settings );
    } else {
      const tabs = await getTargetTabs( command );
      log( 'info', `  Tabs found: ${tabs.length}` );
      if ( tabs.length === 0 ) throw new Error( 'No matching tab found.' );
      const tab = tabs[0];
      log( 'info', `  Tab: #${tab.id} "${tab.title}"` );
      result = await executeCommand( tab.id, command, settings );
    }
    log( 'info', `  Result:`, result );
  } catch ( e ) {
    log( 'error', `  FAILED: ${e.message}` );
    status = 'error';
    result = e.message;
  }

  // Отчитаться серверу
  try {
    const reportUrl = `${serverUrl.replace(/\/$/, '')}/wp-json/brc/v1/result/${id}`;
    await fetch( reportUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, browser_id: browserId, status, result }),
    } );
    log( 'info', `  Reported: status=${status}` );
  } catch ( e ) {
    log( 'error', `  Report failed: ${e.message}` );
  }
}

// ─── Tab selector ─────────────────────────────────────────────────────────────

async function getTargetTabs( command ) {
  if ( command.tab_url ) return await chrome.tabs.query({ url: command.tab_url });
  if ( typeof command.tab_index === 'number' ) {
    const all = await chrome.tabs.query({});
    return all.filter( t => t.index === command.tab_index );
  }

  // Сначала пробуем активную вкладку в последнем окне
  const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const validActive = active.filter( t =>
    t.url && ! t.url.startsWith('chrome-extension://') &&
             ! t.url.startsWith('chrome://') &&
             ! t.url.startsWith('about:')
  );
  if ( validActive.length > 0 ) return validActive;

  // Активная вкладка — служебная (extension popup, about:blank и т.д.)
  // Берём последнюю обычную вкладку в том же окне
  const windowId = active[0]?.windowId;
  const allInWindow = await chrome.tabs.query( windowId ? { windowId } : {} );
  const normal = allInWindow.filter( t =>
    t.url && ! t.url.startsWith('chrome-extension://') &&
             ! t.url.startsWith('chrome://') &&
             ! t.url.startsWith('about:')
  );
  if ( normal.length > 0 ) {
    // Берём последнюю активную (с наибольшим индексом) среди обычных
    return [ normal.sort( (a, b) => b.index - a.index )[0] ];
  }

  // Ничего нет — вернуть пустой массив, команда выдаст понятную ошибку
  return [];
}
