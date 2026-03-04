// popup.js

const $ = id => document.getElementById( id );

const DEFAULT_SERVER = 'https://lp85d.ru';

// ─── Load settings on open ────────────────────────────────────────────────────

chrome.runtime.sendMessage( { action: 'get_settings' }, ( settings ) => {
  if ( ! settings ) return;
  $('browserId').value    = settings.browserId    || '';
  $('serverUrl').value    = settings.serverUrl    || DEFAULT_SERVER;
  $('apiKey').value       = settings.apiKey       || '';
  $('browserLabel').value = settings.browserLabel || '';

  if ( settings.registered ) {
    setStatus( 'ok', '✓ Подключено' );
  } else if ( settings.apiKey ) {
    setStatus( 'idle', 'Введён ключ, нажмите Register' );
  }
} );

// ─── Save settings on input change ───────────────────────────────────────────

[ 'serverUrl', 'apiKey', 'browserLabel' ].forEach( id => {
  $( id ).addEventListener( 'input', saveCurrentSettings );
} );

function saveCurrentSettings() {
  chrome.runtime.sendMessage( { action: 'get_settings' }, ( settings ) => {
    const updated = Object.assign( {}, settings, {
      serverUrl:    $('serverUrl').value.trim() || DEFAULT_SERVER,
      apiKey:       $('apiKey').value.trim(),
      browserLabel: $('browserLabel').value.trim(),
      registered:   false,
    } );
    chrome.storage.local.set( { brc_settings: updated } );
  } );
}

// ─── Copy Browser ID ──────────────────────────────────────────────────────────

$('copyId').addEventListener( 'click', () => {
  const id = $('browserId').value;
  if ( ! id ) return;
  navigator.clipboard.writeText( id ).then( () => {
    $('copyId').textContent = '✓';
    setTimeout( () => { $('copyId').textContent = '📋'; }, 1500 );
  } );
} );

// ─── Register button ─────────────────────────────────────────────────────────

$('btnRegister').addEventListener( 'click', async () => {
  setStatus( 'idle', 'Подключаюсь…' );
  $('btnRegister').disabled = true;

  chrome.runtime.sendMessage( { action: 'register' }, ( res ) => {
    $('btnRegister').disabled = false;
    if ( res && res.ok ) {
      setStatus( 'ok', '✓ Зарегистрирован!' );
      addLog( 'Успешно зарегистрирован на сервере.' );
    } else {
      const msg = ( res && res.error ) ? res.error : 'Ошибка регистрации';
      setStatus( 'error', '✗ ' + msg );
      addLog( msg, true );
    }
  } );
} );

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStatus( type, text ) {
  const row = $('statusRow');
  const dot = $('statusDot');
  const txt = $('statusText');
  row.className = `status-row ${type}`;
  dot.className = `dot ${type}`;
  txt.textContent = text;
}

function addLog( message, isError = false ) {
  const log = $('log');
  const line = document.createElement( 'div' );
  if ( isError ) line.className = 'err';
  const time = new Date().toLocaleTimeString( [], { hour12: false } );
  line.textContent = `[${time}] ${message}`;
  log.appendChild( line );
  const placeholder = log.querySelector( 'span[style]' );
  if ( placeholder ) placeholder.remove();
  log.scrollTop = log.scrollHeight;
}
