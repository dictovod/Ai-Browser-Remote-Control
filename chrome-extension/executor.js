// executor.js — Executes commands inside browser tabs via scripting API
export async function executeCommand( tabId, command, settings = {} ) {
  if ( command.type === 'analyze_image' ) {
    return await analyzeViaGoogleImageSearch( command, settings );
  }

  if ( command.type === 'eval' ) {
    return await executeEvalCommand( tabId, command );
  }

  const results = await chrome.scripting.executeScript( {
    target: { tabId },
    func:   runCommandInPage,
    args:   [ command ],
  } );
  if ( chrome.runtime.lastError ) throw new Error( chrome.runtime.lastError.message );
  const res = results[0];
  if ( res.result && res.result.error ) throw new Error( res.result.error );
  return res.result ? JSON.stringify( res.result ) : 'ok';
}

async function executeEvalCommand( tabId, command ) {
  const code = command.code || '';

  const isGeminiRead = code.includes('message-content') ||
                       code.includes('model-response') ||
                       code.includes('typing-indicator') ||
                       code.includes('BardChatUi') ||
                       code.includes('s:"wait"') ||
                       code.includes('"s":"wait"') ||
                       ( code.includes('s:') && code.includes('typing') && code.includes('done') );

  const isCountCmd = code.includes('__brc_count_responses__');
  if ( isCountCmd ) {
    const results = await chrome.scripting.executeScript( {
      target: { tabId },
      func:   countGeminiResponses,
      args:   [],
    } );
    if ( chrome.runtime.lastError ) throw new Error( chrome.runtime.lastError.message );
    const res = results[0]?.result;
    return JSON.stringify( { eval_result: res } );
  }

  const isHoverCmd = code.includes('__brc_hover_last_user_message__');
  if ( isHoverCmd ) {
    const results = await chrome.scripting.executeScript( {
      target: { tabId },
      func:   hoverLastUserMessage,
      args:   [],
    } );
    if ( chrome.runtime.lastError ) throw new Error( chrome.runtime.lastError.message );
    const res = results[0]?.result;
    return JSON.stringify( { eval_result: res } );
  }

  const isConfirmEdit = code.includes('__brc_confirm_edit__');
  if ( isConfirmEdit ) {
    const results = await chrome.scripting.executeScript( {
      target: { tabId },
      func:   confirmGeminiEdit,
      args:   [],
    } );
    if ( chrome.runtime.lastError ) throw new Error( chrome.runtime.lastError.message );
    const res = results[0]?.result;
    return JSON.stringify( { eval_result: res } );
  }

  const isClearCmd = code.includes('__brc_clear_input__');
  if ( isClearCmd ) {
    const results = await chrome.scripting.executeScript( {
      target: { tabId },
      func:   clearGeminiInput,
      args:   [],
    } );
    if ( chrome.runtime.lastError ) throw new Error( chrome.runtime.lastError.message );
    const res = results[0]?.result;
    return JSON.stringify( { eval_result: res } );
  }

  // ── Вставка текста ───────────────────────────────────────────────────────
  const isFillCmd = code.includes('__brc_fill_edit_field__');
  if ( isFillCmd ) {
    const fillMatch = code.match(/__brc_fill_edit_field__:([A-Za-z0-9+/=]+)/);
    // ИСПРАВЛЕНИЕ КОДИРОВКИ: atob возвращает Latin-1, TextDecoder правильно читает UTF-8
    const fillText = fillMatch ? base64ToUtf8( fillMatch[1] ) : '';
    console.log( '[BRC] Decoded fill text len:', fillText.length, 'preview:', fillText.substring(0, 60) );
    const results = await chrome.scripting.executeScript( {
      target: { tabId },
      func:   waitAndFillEditField,
      args:   [ fillText ],
    } );
    if ( chrome.runtime.lastError ) throw new Error( chrome.runtime.lastError.message );
    const res = results[0]?.result;
    return JSON.stringify( { eval_result: res } );
  }

  if ( isGeminiRead ) {
    const countMatch = code.match(/__brc_prev_count__:(\d+)/);
    const prevCount  = countMatch ? parseInt( countMatch[1] ) : 0;
    const textMatch  = code.match(/__brc_prev_text__:"([^"]*)"/);
    const prevText   = textMatch ? textMatch[1] : '';

    const results = await chrome.scripting.executeScript( {
      target: { tabId },
      func:   readGeminiDOM,
      args:   [ prevCount, prevText ],
    } );
    if ( chrome.runtime.lastError ) throw new Error( chrome.runtime.lastError.message );
    const res = results[0]?.result;
    return JSON.stringify( { eval_result: res } );
  }

  const results = await chrome.scripting.executeScript( {
    target: { tabId },
    func:   runEvalSafe,
    args:   [ code ],
  } );
  if ( chrome.runtime.lastError ) throw new Error( chrome.runtime.lastError.message );
  const res = results[0];
  if ( res.result && res.result.error ) throw new Error( res.result.error );
  return res.result ? JSON.stringify( res.result ) : 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
// base64ToUtf8 — правильное декодирование base64 с UTF-8 (кириллица)
// atob() → бинарная строка Latin-1 → Uint8Array → TextDecoder UTF-8
// ─────────────────────────────────────────────────────────────────────────────
function base64ToUtf8( b64 ) {
  try {
    const binStr = atob( b64 );
    const bytes  = new Uint8Array( binStr.length );
    for ( let i = 0; i < binStr.length; i++ ) {
      bytes[i] = binStr.charCodeAt( i );
    }
    return new TextDecoder( 'utf-8' ).decode( bytes );
  } catch ( e ) {
    console.error( '[BRC] base64ToUtf8 error:', e );
    return atob( b64 );
  }
}

function countGeminiResponses() {
  try {
    var sels = [ 'message-content', 'model-response', 'ms-chat-turn', '.response-container' ];
    for ( var i = 0; i < sels.length; i++ ) {
      var found = document.querySelectorAll( sels[i] );
      if ( found.length > 0 ) return String( found.length );
    }
    return '0';
  } catch ( e ) { return '0'; }
}

function hoverLastUserMessage() {
  try {
    console.log( '%c[BRC-EDIT] hoverLastUserMessage start', 'color:#60a5fa;font-weight:bold' );
    var queries = document.querySelectorAll( 'user-query' );
    if ( !queries.length ) return '{"ok":false,"reason":"no user-query elements"}';
    var el = queries[queries.length - 1];

    el.dispatchEvent( new MouseEvent( 'mouseover',  { bubbles: true } ) );
    el.dispatchEvent( new MouseEvent( 'mouseenter', { bubbles: true } ) );
    el.dispatchEvent( new MouseEvent( 'mousemove',  { bubbles: true } ) );

    var editBtn = null;
    var editIcon = el.querySelector( 'mat-icon[data-mat-icon-name="edit"]' );
    if ( editIcon ) editBtn = editIcon.closest( 'button' );
    if ( !editBtn ) { var ec = el.querySelector('.edit-container button'); if (ec) editBtn = ec; }
    if ( !editBtn ) { var fi2 = el.querySelector('mat-icon[fonticon="edit"]'); if (fi2) editBtn = fi2.closest('button'); }
    if ( !editBtn ) {
      var btns = el.querySelectorAll('button');
      for ( var i = 0; i < btns.length; i++ ) {
        var icon = btns[i].querySelector('mat-icon');
        if ( icon ) {
          var iname = icon.getAttribute('data-mat-icon-name') || icon.getAttribute('fonticon') || icon.textContent.trim();
          if ( iname.toLowerCase() === 'edit' ) { editBtn = btns[i]; break; }
        }
      }
    }
    if ( !editBtn ) {
      var globalBtns = document.querySelectorAll('button');
      for ( var g = 0; g < globalBtns.length; g++ ) {
        var gicon = globalBtns[g].querySelector('mat-icon');
        if ( gicon ) {
          var gname = gicon.getAttribute('data-mat-icon-name') || gicon.getAttribute('fonticon') || gicon.textContent.trim();
          if ( gname.toLowerCase() === 'edit' ) { editBtn = globalBtns[g]; break; }
        }
      }
    }
    if ( editBtn ) {
      editBtn.style.visibility = 'visible';
      editBtn.style.opacity    = '1';
      editBtn.style.display    = '';
      editBtn.click();
      return '{"ok":true,"action":"edit_clicked"}';
    }
    return '{"ok":false,"reason":"edit button not found"}';
  } catch ( e ) {
    return '{"ok":false,"reason":' + JSON.stringify( e.message ) + '}';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// waitAndFillEditField — ИСПРАВЛЕННАЯ ВЕРСИЯ
//
// Проблема из лога: len=12 при тексте длиной 318 байт.
// "Ремень 1270" = 12 символов — в поле попал ТОЛЬКО пользовательский запрос
// без промпта. Это означает что Angular перезаписывал значение после вставки,
// т.к. видел что textarea уже содержит старый текст и не принял новый.
//
// Решение: используем execCommand('insertText') — единственный способ вставить
// текст в Angular-поле так чтобы фреймворк его принял. Это имитирует реальный
// ввод с клавиатуры.
// ─────────────────────────────────────────────────────────────────────────────
function waitAndFillEditField( text ) {
  console.log( '%c[BRC-FILL] start, textLen=' + text.length, 'color:#60a5fa;font-weight:bold' );
  console.log( '[BRC-FILL] first 80 chars:', text.substring(0, 80) );

  var SELS = [
    'user-query .edit-container [contenteditable="true"]',
    'user-query [contenteditable="true"]',
    'user-query textarea',
    'rich-textarea div[contenteditable="true"]',
    'div[role="textbox"]',
  ];

  function findField() {
    for ( var s = 0; s < SELS.length; s++ ) {
      var f = document.querySelector( SELS[s] );
      if ( f ) {
        var r = f.getBoundingClientRect();
        if ( r.width > 0 || r.height > 0 ) {
          console.log( '[BRC-FILL] found:', SELS[s], 'tag:', f.tagName );
          return f;
        }
      }
    }
    var all = document.querySelectorAll( '[contenteditable="true"], textarea' );
    for ( var c = 0; c < all.length; c++ ) {
      var r2 = all[c].getBoundingClientRect();
      if ( all[c].closest('user-query') && r2.width > 10 && r2.height > 10 ) return all[c];
    }
    return null;
  }

  var field = findField();
  if ( !field ) {
    console.warn( '[BRC-FILL] field NOT found' );
    return JSON.stringify({ ok: false, reason: 'field not found' });
  }

  field.focus();

  if ( field.tagName === 'TEXTAREA' ) {
    // ── TEXTAREA (Angular) ────────────────────────────────────────────────
    // Шаг 1: выделяем всё и удаляем через execCommand — Angular видит это как
    // реальное действие пользователя и обновляет свою модель данных
    field.select();
    document.execCommand( 'delete', false, null );

    // Шаг 2: вставляем весь промпт одной командой insertText
    // execCommand('insertText') — это стандарт для редакторов, Angular его слушает
    var inserted = document.execCommand( 'insertText', false, text );
    console.log( '[BRC-FILL] execCommand insertText:', inserted, 'val.len:', field.value.length );

    var afterLen = field.value.length;

    // Запасной вариант если execCommand не сработал
    if ( afterLen < Math.min( text.length * 0.5, 50 ) ) {
      console.log( '[BRC-FILL] execCommand failed (len=' + afterLen + '), trying nativeSetter...' );

      // nativeSetter обходит Angular value-interceptor
      var proto  = window.HTMLTextAreaElement.prototype;
      var setter = Object.getOwnPropertyDescriptor( proto, 'value' );
      if ( setter && setter.set ) {
        setter.set.call( field, text );
      } else {
        field.value = text;
      }

      // Цепочка событий которую ждёт Angular
      field.dispatchEvent( new Event( 'focus',   { bubbles: true } ) );
      field.dispatchEvent( new InputEvent( 'input', {
        bubbles:   true,
        data:      text,
        inputType: 'insertText',
      } ) );
      field.dispatchEvent( new Event( 'change',  { bubbles: true } ) );
      field.dispatchEvent( new KeyboardEvent( 'keydown', { bubbles: true, key: 'End' } ) );
      field.dispatchEvent( new KeyboardEvent( 'keyup',   { bubbles: true, key: 'End' } ) );

      afterLen = field.value.length;
      console.log( '[BRC-FILL] nativeSetter result len:', afterLen );
    }

    return JSON.stringify({ ok: true, len: afterLen, fieldType: 'TEXTAREA' });

  } else {
    // ── contenteditable ───────────────────────────────────────────────────
    var range = document.createRange();
    range.selectNodeContents( field );
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange( range );
    document.execCommand( 'delete', false, null );
    document.execCommand( 'insertText', false, text );

    var cLen = ( field.innerText || field.textContent || '' ).length;
    if ( cLen < Math.min( text.length * 0.5, 50 ) ) {
      field.innerText = text;
      field.dispatchEvent( new InputEvent( 'input', { bubbles: true, data: text, inputType: 'insertText' } ) );
      field.dispatchEvent( new Event( 'change', { bubbles: true } ) );
      cLen = ( field.innerText || field.textContent || '' ).length;
    }

    return JSON.stringify({ ok: true, len: cLen, fieldType: 'contenteditable' });
  }
}

function confirmGeminiEdit() {
  try {
    var confirmBtn = document.querySelector( 'button.update-button' );
    if ( confirmBtn ) { confirmBtn.click(); return '{"ok":true,"found":"button.update-button"}'; }
    var allBtns = document.querySelectorAll( 'user-query button, .edit-container button' );
    for ( var i = 0; i < allBtns.length; i++ ) {
      var txt = ( allBtns[i].textContent || '' ).trim().toLowerCase();
      if ( txt === 'обновить' || txt === 'update' || txt === 'применить' || txt === 'save' ) {
        allBtns[i].click(); return '{"ok":true,"found":"text:' + txt + '"}';
      }
    }
    var pageBtns = document.querySelectorAll( 'button' );
    for ( var j = 0; j < pageBtns.length; j++ ) {
      var ptxt = ( pageBtns[j].textContent || '' ).trim().toLowerCase();
      if ( ptxt === 'обновить' || ptxt === 'update' ) { pageBtns[j].click(); return '{"ok":true,"found":"global:' + ptxt + '"}'; }
    }
    return '{"ok":false,"reason":"update-button not found"}';
  } catch ( e ) { return '{"ok":false,"reason":' + JSON.stringify( e.message ) + '}'; }
}

function clearGeminiInput() {
  try {
    var el =
      document.querySelector( 'user-query .edit-container [contenteditable="true"]' ) ||
      document.querySelector( 'user-query [contenteditable="true"]' ) ||
      document.querySelector( 'user-query textarea' ) ||
      document.querySelector( 'div[role="textbox"]' ) ||
      document.querySelector( 'rich-textarea div[contenteditable="true"]' );
    if ( !el ) return '{"ok":false,"reason":"input not found"}';
    el.focus();
    var range = document.createRange();
    range.selectNodeContents( el );
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange( range );
    document.execCommand( 'delete' );
    if ( ( el.innerText || el.textContent || el.value || '' ).trim().length > 0 ) {
      if ( el.tagName === 'TEXTAREA' ) el.value = '';
      else el.innerText = '';
      el.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
    }
    return '{"ok":true}';
  } catch ( e ) { return '{"ok":false,"reason":' + JSON.stringify( e.message ) + '}'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// readGeminiDOM — читает ответ + картинки.
// Картинки читаем только когда ответ стабилен (isTyping=false),
// т.к. Gemini загружает их lazy — после появления текста.
// URL картинок передаём серверу, сервер скачает их сам (обходя CORS).
// ─────────────────────────────────────────────────────────────────────────────
function readGeminiDOM( prevCount, prevText ) {
  prevText = prevText || '';
  try {
    var sels = [
      'model-response',
      'message-content',
      '.model-response-text',
      'ms-chat-turn model-response',
      '.response-container',
    ];
    var els = [];
    for ( var i = 0; i < sels.length; i++ ) {
      var found = Array.from( document.querySelectorAll( sels[i] ) ).filter(function(el) {
        var s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetHeight > 0;
      });
      if ( found.length > 0 ) { els = found; break; }
    }
    if ( els.length === 0 ) return '{"s":"wait","n":0,"total":0}';

    var last = els[els.length - 1];
    var text = ( last.innerText || last.textContent || '' ).trim();
    if ( !text || text.length < 30 ) return '{"s":"wait","n":' + text.length + ',"total":' + els.length + '}';

    var isTyping = !! (
      document.querySelector('.typing-indicator') ||
      document.querySelector('.loading-indicator') ||
      document.querySelector('[data-is-loading="true"]') ||
      last.querySelector('.spinner') ||
      last.querySelector('[class*="loading"]') ||
      document.querySelector('model-response [aria-busy="true"]')
    );

    if ( prevText && text === prevText ) {
      return '{"s":"wait","n":' + text.length + ',"total":' + els.length + ',"unchanged":true}';
    }

    // ── КАРТИНКИ ────────────────────────────────────────────────────────────
    // Читаем только после завершения генерации
    var images = [];
    if ( !isTyping ) {
      var seen = new Set();

      // 1. data-full-size-image-uri — полноразмерные картинки (Gemini AI компоненты)
      last.querySelectorAll('[data-full-size-image-uri]').forEach(function(el) {
        var uri = el.getAttribute('data-full-size-image-uri');
        if ( uri && !uri.startsWith('data:') && !seen.has(uri) ) {
          seen.add(uri); images.push(uri);
        }
      });

      // 2. encrypted-tbn — превью из Google Images (встроены в ответы Gemini с поиском)
      last.querySelectorAll('img').forEach(function(img) {
        var src = img.src || img.getAttribute('data-src') || '';
        if ( !src || seen.has(src) ) return;
        if ( src.includes('encrypted-tbn') ) { seen.add(src); images.push(src); return; }
        if ( src.startsWith('data:') || src.includes('favicon') ) return;
        var w = img.naturalWidth  || parseInt(img.getAttribute('width'))  || 0;
        var h = img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
        if ( w >= 80 || h >= 80 ) { seen.add(src); images.push(src); }
      });

      // 3. Родительские контейнеры single-image
      last.querySelectorAll('.image-container, single-image').forEach(function(cont) {
        var check = cont;
        for ( var d = 0; d < 4; d++ ) {
          var attr = check.getAttribute('data-full-size-image-uri');
          if ( attr && !seen.has(attr) ) { seen.add(attr); images.push(attr); break; }
          if ( !check.parentElement ) break;
          check = check.parentElement;
        }
      });

      images = images.slice(0, 5);
      if ( images.length > 0 ) {
        console.log( '[BRC-READ] Images found:', images.length );
      }
    }

    var truncated = text.length > 3500 ? text.substring(0, 3500) : text;
    return JSON.stringify({
      s:      isTyping ? 'typing' : 'done',
      t:      truncated,
      n:      text.length,
      total:  els.length,
      images: images,   // массив URL — сервер скачает их сам
    });
  } catch ( e ) {
    return '{"s":"error","msg":' + JSON.stringify( e.message ) + '}';
  }
}

function runEvalSafe( code ) {
  try {
    var fn     = new Function( 'return (' + code + ')' );
    var result = fn();
    if ( result && typeof result.then === 'function' ) return { eval_result: '[Promise - async not supported]' };
    return { eval_result: String( result !== undefined ? result : '' ) };
  } catch ( e ) { return { error: e.message }; }
}

async function analyzeViaGoogleImageSearch( command, settings ) {
  const { image_id } = command;
  const { serverUrl, apiKey } = settings;
  if ( !image_id ) throw new Error( 'analyze_image: image_id is required' );
  const base    = serverUrl.replace( /\/$/, '' );
  const imgResp = await fetch( `${base}/wp-json/brc/v1/image/${image_id}?api_key=${encodeURIComponent(apiKey)}` );
  if ( !imgResp.ok ) throw new Error( `Image fetch failed: ${imgResp.status}` );
  const imgData = await imgResp.json();
  const { image_base64, mime_type } = imgData;
  if ( !image_base64 ) throw new Error( 'Image data empty from server' );
  const tab = await chrome.tabs.create( { url: 'https://www.google.com/imghp?hl=ru', active: false } );
  await new Promise( ( resolve, reject ) => {
    const t = setTimeout( () => reject( new Error('Tab load timeout') ), 30_000 );
    const listener = ( tabId, info ) => {
      if ( tabId !== tab.id || info.status !== 'complete' ) return;
      chrome.tabs.onUpdated.removeListener( listener ); clearTimeout(t); resolve();
    };
    chrome.tabs.onUpdated.addListener( listener );
  });
  await new Promise( r => setTimeout( r, 1000 ) );
  const dropResults = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: doDropFile, args: [image_base64, mime_type] });
  const dropResult = dropResults[0]?.result;
  if ( dropResult?.error ) throw new Error( 'Drop failed: ' + dropResult.error );
  const maxWait = 90_000, interval = 2_000, started = Date.now();
  while ( Date.now() - started < maxWait ) {
    await new Promise( r => setTimeout( r, interval ) );
    let pollResult;
    try {
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractGoogleResults, args: [] });
      pollResult = res[0]?.result;
    } catch (e) { continue; }
    if ( pollResult?.text ) { chrome.tabs.remove(tab.id).catch(()=>{}); return pollResult.text; }
  }
  chrome.tabs.remove(tab.id).catch(()=>{});
  throw new Error( 'Google Image Search timeout (90s)' );
}

function doDropFile( image_base64, mime_type ) {
  try {
    const bytes = Uint8Array.from( atob(image_base64), c => c.charCodeAt(0) );
    const blob  = new Blob( [bytes], { type: mime_type || 'image/jpeg' } );
    const ext   = (mime_type || 'image/jpeg').split('/')[1] || 'jpg';
    const file  = new File( [blob], `photo.${ext}`, { type: mime_type } );
    const doDrop = (target) => {
      const dt = new DataTransfer(); dt.items.add(file);
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent('dragenter', opts));
      target.dispatchEvent(new DragEvent('dragover',  opts));
      target.dispatchEvent(new DragEvent('drop',      opts));
    };
    const cameraSelectors = [
      '[aria-label="Поиск по картинке"]','[aria-label="Search by image"]',
      '[data-base-lens-url]','div[jsname="qIiZ1"] button','button[jsname="CrS9S"]',
    ];
    let cameraBtn = null;
    for ( const sel of cameraSelectors ) { cameraBtn = document.querySelector(sel); if (cameraBtn) break; }
    if ( !cameraBtn ) {
      for ( const btn of document.querySelectorAll('button, [role="button"]') ) {
        if ( btn.querySelector('svg') && (btn.title?.includes('карт') || btn.title?.includes('image')) ) { cameraBtn = btn; break; }
      }
    }
    if ( !cameraBtn ) return { error: 'Camera button not found' };
    cameraBtn.click();
    setTimeout(() => {
      const dropSels = ['div[jsname="R3B1jc"]','.DV7the','.K4g7uf','c-wiz[jsrenderer]'];
      let dropTarget = null;
      for ( const sel of dropSels ) { dropTarget = document.querySelector(sel); if (dropTarget) break; }
      doDrop(dropTarget || document.body);
      const fi = document.querySelector('input[type="file"]');
      if (fi) {
        const dt2 = new DataTransfer(); dt2.items.add(file);
        Object.defineProperty(fi,'files',{value:dt2.files,configurable:true});
        fi.dispatchEvent(new Event('change',{bubbles:true}));
      }
    }, 1500);
    return { status: 'drop_dispatched' };
  } catch (e) { return { error: e.message }; }
}

function extractGoogleResults() {
  const url = location.href;
  const huuidLeafs = [];
  for ( const el of document.querySelectorAll('[data-huuid]') ) {
    if ( el.querySelector('[data-huuid]') ) continue;
    const t = (el.innerText || el.textContent || '').trim();
    if ( t.length >= 10 ) huuidLeafs.push(t);
  }
  if ( huuidLeafs.length === 0 ) return { url };
  const parts = [], seen = new Set();
  const add = (raw) => { const t=(raw||'').trim(); if(t.length>=10 && !seen.has(t)){seen.add(t);parts.push(t);} };
  for ( const el of document.querySelectorAll('[aria-level="2"][role="heading"]') ) add(el.innerText||'');
  for ( const t of huuidLeafs ) add(t);
  if ( parts.length === 0 ) return { url };
  return { text: parts.join('\n').slice(0, 3000), url };
}

function runCommandInPage(command) {
  function getEl(sel) { const el=document.querySelector(sel); if(!el) throw new Error(`Element not found: ${sel}`); return el; }
  function mouse(el, ev) { el.dispatchEvent(new MouseEvent(ev,{bubbles:true,cancelable:true})); }
  try {
    const { type, selector, value } = command;
    if (type==='type') {
      const el=getEl(selector); el.scrollIntoView({block:'center'}); el.focus();
      document.execCommand('insertText',false,value);
      if (!el.innerText.includes(value)) el.innerText=value;
      ['input','keydown','keyup','change'].forEach(n=>el.dispatchEvent(new Event(n,{bubbles:true})));
      return {ok:true,textNow:el.innerText};
    }
    if (type==='click') {
      const el=getEl(selector); el.scrollIntoView({behavior:'smooth',block:'center'});
      mouse(el,'mouseover'); mouse(el,'mousedown'); el.click(); mouse(el,'mouseup'); return {clicked:selector};
    }
    if (type==='click_coords') {
      const el=document.elementFromPoint(command.x,command.y);
      if (!el) throw new Error(`No element at (${command.x},${command.y})`);
      mouse(el,'mousedown'); el.click(); mouse(el,'mouseup');
      return {clicked_at:{x:command.x,y:command.y},tag:el.tagName};
    }
    if (type==='scroll') {
      const t=selector?document.querySelector(selector):window;
      const d=command.direction==='up'?-1:1, a=command.amount??300;
      (t===window?window:t).scrollBy({top:d*a,behavior:'smooth'});
      return {scrolled:{direction:command.direction,amount:a}};
    }
    if (type==='type_nth') {
      const nth=command.nth||1;
      const all=Array.from(document.querySelectorAll(
        'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file]),textarea'
      )).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
      if (all.length<nth) throw new Error(`Only ${all.length} inputs, requested #${nth}`);
      const el=all[nth-1];
      if (el.readOnly) throw new Error('readOnly'); if (el.disabled) throw new Error('disabled');
      el.scrollIntoView({behavior:'smooth',block:'center'}); el.focus();
      if (command.clear!==false){el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));}
      const proto=el instanceof HTMLTextAreaElement?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value');
      if (setter?.set) setter.set.call(el,command.value); else el.value=command.value;
      el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
      if (el.value!==command.value){el.focus();document.execCommand('selectAll');document.execCommand('insertText',false,command.value);}
      return {ok:el.value===command.value};
    }
    if (type==='checkbox'){const el=getEl(selector);if(el.type!=='checkbox')throw new Error('Not a checkbox');const desired=typeof command.checked==='boolean'?command.checked:!el.checked;if(el.checked!==desired)el.click();return {checked:el.checked};}
    if (type==='radio'){const el=getEl(selector);if(!el.checked)el.click();return {checked:el.checked};}
    if (type==='select'){
      const el=getEl(selector);let found=false;
      for(const opt of el.options){if(opt.value===String(command.value)||opt.text===String(command.value)){opt.selected=true;found=true;break;}}
      if(!found) throw new Error(`Option "${command.value}" not found`);
      el.dispatchEvent(new Event('change',{bubbles:true})); return {selected:command.value};
    }
    if (type==='navigate'){window.location.href=command.url;return {navigating_to:command.url};}
    throw new Error(`Unknown command type: ${type}`);
  } catch(e){ return {error:e.message}; }
}
