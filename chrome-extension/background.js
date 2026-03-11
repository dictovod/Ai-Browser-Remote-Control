// background.js — Service Worker (MV3)
// Long-polling: расширение держит постоянное соединение с сервером.
// Запрос к /poll висит до 25 сек (или ответа с командой), затем сразу новый.
// Нагрузка: ~3 500 зап/сутки вместо ~260 000 при обычном поллинге.

import { generateBrowserId, getSettings, saveSettings } from './utils.js';
import { executeCommand } from './executor.js';

// Alarm нужен ТОЛЬКО для поддержания Service Worker живым (SW засыпает через ~30 сек)
const ALARM_NAME = 'brc_keepalive';

// ─── Лог с временной меткой ───────────────────────────────────────────────────

function log( level, ...args ) {
  const ts = new Date().toISOString().replace('T',' ').slice(0,19);
  const prefix = `[BRC ${ts}]`;
  if      ( level === 'error' ) console.error( prefix, ...args );
  else if ( level === 'warn'  ) console.warn(  prefix, ...args );
  else                          console.log(   prefix, ...args );
}

// ─── Держать SW живым (alarm каждые 20 сек) ───────────────────────────────────
// SW засыпает через ~30 сек бездействия — alarm не даёт этого сделать.
// При long-poll соединение висит 25 сек, поэтому alarm на 20 сек — в самый раз.

function keepAlive() {
  chrome.alarms.get( ALARM_NAME, ( alarm ) => {
    if ( ! alarm ) {
      chrome.alarms.create( ALARM_NAME, { periodInMinutes: 0.33 } ); // ~20 сек
      log( 'info', 'Keep-alive alarm created (20s)' );
    }
  } );
}

// Alarm только поддерживает SW живым — поллинг теперь самостоятельный цикл
chrome.alarms.onAlarm.addListener( ( alarm ) => {
  if ( alarm.name === ALARM_NAME ) {
    // Ничего не делаем — достаточно того, что SW проснулся
    // Цикл pollLoop() сам себя поддерживает через рекурсию
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
  startPollLoop();
} );

chrome.runtime.onStartup.addListener( async () => {
  log( 'info', '=== Browser started ===' );
  keepAlive();
  await autoRegisterIfNeeded();
  startPollLoop();
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
    // В long-poll режиме просто сообщаем что цикл активен
    sendResponse({ ok: true, mode: 'long-poll' });
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
  startPollLoop();
  return { ok: true, data };
}

// ─── Long-Poll Loop ───────────────────────────────────────────────────────────
// Один экземпляр цикла. Флаг предотвращает дублирование при повторных вызовах.

let _pollLoopRunning = false;

function startPollLoop() {
  if ( _pollLoopRunning ) {
    log( 'info', 'Poll loop already running, skipping duplicate start.' );
    return;
  }
  _pollLoopRunning = true;
  log( 'info', 'Long-poll loop started.' );
  pollLoop();
}

async function pollLoop() {
  while ( true ) {
    const settings = await getSettings();
    const { serverUrl, apiKey, browserId, registered } = settings;

    if ( ! serverUrl || ! apiKey || ! browserId || ! registered ) {
      // Нет конфигурации — ждём 10 сек и проверяем снова
      await sleep( 10_000 );
      continue;
    }

    try {
      await doLongPoll( settings );
    } catch ( e ) {
      log( 'error', 'Poll error:', e.message );
      // При сетевой ошибке — пауза 5 сек перед повтором (не спамим сервер)
      await sleep( 5_000 );
    }
    // Успешный ответ (пустой или с командами) — сразу новый запрос без паузы
  }
}

async function doLongPoll( settings ) {
  const { serverUrl, apiKey, browserId } = settings;

  const url = `${serverUrl.replace(/\/$/, '')}/wp-json/brc/v1/poll`
    + `?api_key=${encodeURIComponent(apiKey)}&browser_id=${encodeURIComponent(browserId)}`;

  // Таймаут fetch: чуть больше серверного (55 сек) — чтобы сервер успел ответить первым
  const controller = new AbortController();
  const fetchTimeout = setTimeout( () => controller.abort(), 60_000 );

  let data;
  try {
    const res = await fetch( url, { signal: controller.signal } );
    clearTimeout( fetchTimeout );
    if ( ! res.ok ) {
      log( 'error', 'Poll HTTP error:', res.status );
      return;
    }
    data = await res.json();
  } catch ( e ) {
    clearTimeout( fetchTimeout );
    if ( e.name === 'AbortError' ) {
      log( 'warn', 'Poll fetch timed out (60s), reconnecting…' );
      return;
    }
    throw e;
  }

  const commands = data.commands || [];
  if ( commands.length > 0 ) {
    log( 'info', `Long-poll: got ${commands.length} command(s) after ${data.waited ?? '?'}s` );
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

  const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const validActive = active.filter( t =>
    t.url && ! t.url.startsWith('chrome-extension://') &&
             ! t.url.startsWith('chrome://') &&
             ! t.url.startsWith('about:')
  );
  if ( validActive.length > 0 ) return validActive;

  const windowId = active[0]?.windowId;
  const allInWindow = await chrome.tabs.query( windowId ? { windowId } : {} );
  const normal = allInWindow.filter( t =>
    t.url && ! t.url.startsWith('chrome-extension://') &&
             ! t.url.startsWith('chrome://') &&
             ! t.url.startsWith('about:')
  );
  if ( normal.length > 0 ) {
    return [ normal.sort( (a, b) => b.index - a.index )[0] ];
  }

  return [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep( ms ) {
  return new Promise( resolve => setTimeout( resolve, ms ) );
}
