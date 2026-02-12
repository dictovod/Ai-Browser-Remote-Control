// background.js — Service Worker (MV3)
// Решение проблемы засыпания SW: chrome.alarms каждые 25 сек + сразу поллим при любом пробуждении

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
// MV3 Service Worker засыпает через ~30 сек бездействия.
// chrome.alarms будит его каждые 6 сек — это единственный надёжный способ.

function keepAlive() {
  chrome.alarms.get( ALARM_NAME, ( alarm ) => {
    if ( ! alarm ) {
      chrome.alarms.create( ALARM_NAME, { periodInMinutes: 0.1 } ); // ~6 сек
      log( 'info', 'Keep-alive alarm created (every ~6 sec)' );
    }
  } );
}

// ─── При каждом пробуждении SW сразу поллим ───────────────────────────────────

chrome.alarms.onAlarm.addListener( ( alarm ) => {
  if ( alarm.name === ALARM_NAME ) {
    log( 'info', 'Alarm fired → polling' );
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
    log( 'info', 'Registered:', settings.registered ? 'YES' : 'NO' );
  }

  keepAlive();
  await autoRegisterIfNeeded(); // авторегистрация при наличии настроек
  pollCommands();
} );

chrome.runtime.onStartup.addListener( async () => {
  log( 'info', '=== Browser started ===' );
  keepAlive();
  await autoRegisterIfNeeded(); // авторегистрация при каждом старте браузера
  pollCommands();
} );

// ─── Авторегистрация ──────────────────────────────────────────────────────────
// Если есть serverUrl и apiKey — регистрируемся автоматически без участия пользователя

async function autoRegisterIfNeeded() {
  const settings = await getSettings();
  const { serverUrl, apiKey, browserId } = settings;

  if ( ! serverUrl || ! apiKey || ! browserId ) {
    log( 'info', 'Auto-register skipped — settings incomplete' );
    return;
  }

  log( 'info', 'Auto-registering browser...' );
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
    log( 'info', 'Auto-register HTTP', res.status, JSON.stringify( data ) );

    if ( res.ok ) {
      await saveSettings({ ...settings, registered: true });
      log( 'info', 'Auto-register OK: status =', data.status );
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

  log( 'info', 'Registering...' );
  log( 'info', '  serverUrl:', serverUrl );
  log( 'info', '  browserId:', browserId );

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
  log( 'info', 'Registered OK — starting keep-alive' );
  keepAlive();
  pollCommands(); // сразу поллим после регистрации

  return { ok: true, data };
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

async function pollCommands() {
  const settings = await getSettings();
  const { serverUrl, apiKey, browserId, registered } = settings;

  if ( ! serverUrl || ! apiKey || ! browserId ) {
    log( 'warn', 'Poll skipped — settings incomplete' );
    return;
  }
  if ( ! registered ) {
    log( 'warn', 'Poll skipped — not registered' );
    return;
  }

  const url = `${serverUrl.replace(/\/$/, '')}/wp-json/brc/v1/poll`
    + `?api_key=${encodeURIComponent(apiKey)}&browser_id=${encodeURIComponent(browserId)}`;

  log( 'info', 'Polling...' );

  let data;
  try {
    const res = await fetch( url );
    log( 'info', 'Poll HTTP', res.status );
    if ( ! res.ok ) {
      log( 'error', 'Poll error:', res.status, await res.text() );
      return;
    }
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
    const tabs = await getTargetTabs( command );
    log( 'info', `  Tabs found: ${tabs.length}` );

    if ( tabs.length === 0 ) throw new Error( 'No matching tab found.' );

    const tab = tabs[0];
    log( 'info', `  Tab: #${tab.id} "${tab.title}" ${tab.url}` );

    result = await executeCommand( tab.id, command );
    log( 'info', `  Result:`, result );

  } catch ( e ) {
    log( 'error', `  FAILED: ${e.message}` );
    status = 'error';
    result = e.message;
  }

  // Отчитаться серверу
  try {
    const reportUrl = `${serverUrl.replace(/\/$/, '')}/wp-json/brc/v1/result/${id}`;
    const reportRes = await fetch( reportUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, browser_id: browserId, status, result }),
    } );
    const reportData = await reportRes.json();
    log( 'info', `  Reported HTTP ${reportRes.status}: status=${status}`, JSON.stringify( reportData ) );
  } catch ( e ) {
    log( 'error', `  Report failed: ${e.message}` );
  }
}

// ─── Tab selector ─────────────────────────────────────────────────────────────

async function getTargetTabs( command ) {
  if ( command.tab_url ) {
    return await chrome.tabs.query({ url: command.tab_url });
  }
  if ( typeof command.tab_index === 'number' ) {
    const all = await chrome.tabs.query({});
    return all.filter( t => t.index === command.tab_index );
  }
  return await chrome.tabs.query({ active: true, lastFocusedWindow: true });
}