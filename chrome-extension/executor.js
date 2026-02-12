// executor.js — Executes commands inside browser tabs via scripting API

/**
 * Injects the command handler into the target tab and returns the result.
 * @param {number} tabId
 * @param {object} command
 * @returns {Promise<string>}
 */
export async function executeCommand( tabId, command ) {
  const results = await chrome.scripting.executeScript( {
    target: { tabId },
    func:   runCommandInPage,
    args:   [ command ],
  } );

  if ( chrome.runtime.lastError ) {
    throw new Error( chrome.runtime.lastError.message );
  }

  const res = results[0];
  if ( res.result && res.result.error ) {
    throw new Error( res.result.error );
  }
  return res.result ? JSON.stringify( res.result ) : 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
// This function is SERIALISED and injected into the page context.
// It must be self-contained (no imports, no closures from outer scope).
// ─────────────────────────────────────────────────────────────────────────────

function runCommandInPage( command ) {
  // ── Helpers ────────────────────────────────────────────────────────────────

  function getElement( selector ) {
    const el = document.querySelector( selector );
    if ( ! el ) throw new Error( `Element not found: ${selector}` );
    return el;
  }

  function simulateMouseEvent( el, eventName ) {
    el.dispatchEvent( new MouseEvent( eventName, { bubbles: true, cancelable: true } ) );
  }

  function triggerInput( el ) {
    el.dispatchEvent( new Event( 'input',  { bubbles: true } ) );
    el.dispatchEvent( new Event( 'change', { bubbles: true } ) );
  }

  // ── Command handlers ───────────────────────────────────────────────────────

  try {
    const type = command.type;

    // ── click: click on a CSS selector ──────────────────────────────────────
    if ( type === 'click' ) {
      const el = getElement( command.selector );
      el.scrollIntoView( { behavior: 'smooth', block: 'center' } );
      simulateMouseEvent( el, 'mouseover' );
      simulateMouseEvent( el, 'mousedown' );
      el.click();
      simulateMouseEvent( el, 'mouseup' );
      return { clicked: command.selector };
    }

    // ── click_coords: click at specific page coordinates ────────────────────
    if ( type === 'click_coords' ) {
      const el = document.elementFromPoint( command.x, command.y );
      if ( ! el ) throw new Error( `No element at (${command.x}, ${command.y})` );
      simulateMouseEvent( el, 'mousedown' );
      el.click();
      simulateMouseEvent( el, 'mouseup' );
      return { clicked_at: { x: command.x, y: command.y }, tag: el.tagName };
    }

    // ── scroll: scroll the page or an element ───────────────────────────────
    if ( type === 'scroll' ) {
      const target    = command.selector ? document.querySelector( command.selector ) : window;
      const direction = command.direction === 'up' ? -1 : 1;
      const amount    = typeof command.amount === 'number' ? command.amount : 300;

      if ( target === window ) {
        window.scrollBy( { top: direction * amount, behavior: 'smooth' } );
      } else {
        target.scrollBy( { top: direction * amount, behavior: 'smooth' } );
      }
      return { scrolled: { direction: command.direction, amount } };
    }

    // ── type: set value of an input / textarea ───────────────────────────────
    if ( type === 'type' ) {
      const el = getElement( command.selector );

      // Отладка: информация об элементе
      const elInfo = {
        tag:         el.tagName,
        type:        el.type       || 'no-type',
        name:        el.name       || '',
        id:          el.id         || '',
        readOnly:    el.readOnly,
        disabled:    el.disabled,
        valueBefore: el.value,
        url:         window.location.href,
      };

      if ( el.readOnly  ) throw new Error( 'Element is readOnly. Debug: ' + JSON.stringify(elInfo) );
      if ( el.disabled  ) throw new Error( 'Element is disabled. Debug: ' + JSON.stringify(elInfo) );
      if ( el.type === 'file' ) throw new Error( 'Element is file input. Debug: ' + JSON.stringify(elInfo) );

      el.focus();

      // Очистить если нужно
      if ( command.clear !== false ) {
        el.value = '';
        el.dispatchEvent( new Event( 'input',  { bubbles: true } ) );
      }

      // Попытка 1: через native setter (React/Vue/Angular)
      const proto = el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor( proto, 'value' );
      if ( nativeSetter && nativeSetter.set ) {
        nativeSetter.set.call( el, command.value );
      } else {
        el.value = command.value;
      }

      // Запустить все события
      el.dispatchEvent( new Event( 'input',  { bubbles: true } ) );
      el.dispatchEvent( new Event( 'change', { bubbles: true } ) );
      el.dispatchEvent( new KeyboardEvent( 'keyup', { bubbles: true } ) );

      // Попытка 2: если значение не установилось — посимвольный ввод
      if ( el.value !== command.value ) {
        el.focus();
        document.execCommand( 'selectAll', false, null );
        document.execCommand( 'insertText', false, command.value );
      }

      elInfo.valueAfter = el.value;
      elInfo.ok = ( el.value === command.value );

      return {
        ok:       elInfo.ok,
        typed:    command.value.length + ' chars',
        selector: command.selector,
        debug:    elInfo,
      };
    }

    // ── type_nth: type into the N-th visible input (1-based, ignores hidden) ─
    if ( type === 'type_nth' ) {
      const nth  = command.nth || 1;
      const all  = Array.from( document.querySelectorAll(
        'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea'
      ) ).filter( el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0; // только видимые
      } );

      if ( all.length < nth ) {
        throw new Error( `Only ${all.length} visible input(s) found, requested #${nth}` );
      }

      const el = all[ nth - 1 ];

      const elInfo = {
        tag:         el.tagName,
        type:        el.type       || 'no-type',
        name:        el.name       || '',
        id:          el.id         || '',
        readOnly:    el.readOnly,
        disabled:    el.disabled,
        valueBefore: el.value,
        url:         window.location.href,
        nthFound:    nth,
        totalInputs: all.length,
      };

      if ( el.readOnly ) throw new Error( 'Element is readOnly. Debug: ' + JSON.stringify(elInfo) );
      if ( el.disabled ) throw new Error( 'Element is disabled. Debug: ' + JSON.stringify(elInfo) );

      el.scrollIntoView( { behavior: 'smooth', block: 'center' } );
      el.focus();

      if ( command.clear !== false ) {
        el.value = '';
        el.dispatchEvent( new Event( 'input', { bubbles: true } ) );
      }

      const proto = el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor( proto, 'value' );
      if ( nativeSetter && nativeSetter.set ) {
        nativeSetter.set.call( el, command.value );
      } else {
        el.value = command.value;
      }

      el.dispatchEvent( new Event( 'input',  { bubbles: true } ) );
      el.dispatchEvent( new Event( 'change', { bubbles: true } ) );
      el.dispatchEvent( new KeyboardEvent( 'keyup', { bubbles: true } ) );

      if ( el.value !== command.value ) {
        el.focus();
        document.execCommand( 'selectAll', false, null );
        document.execCommand( 'insertText', false, command.value );
      }

      elInfo.valueAfter = el.value;
      elInfo.ok = ( el.value === command.value );

      return {
        ok:       elInfo.ok,
        typed:    command.value.length + ' chars',
        nth:      nth,
        debug:    elInfo,
      };
    }

    // ── checkbox: set a checkbox to checked / unchecked ─────────────────────
    if ( type === 'checkbox' ) {
      const el = getElement( command.selector );
      if ( el.type !== 'checkbox' ) throw new Error( 'Element is not a checkbox.' );
      const desired = typeof command.checked === 'boolean' ? command.checked : ! el.checked;
      if ( el.checked !== desired ) {
        el.click(); // fires native change event
      }
      return { checkbox: command.selector, checked: el.checked };
    }

    // ── radio: select a radio button ─────────────────────────────────────────
    if ( type === 'radio' ) {
      const el = getElement( command.selector );
      if ( el.type !== 'radio' ) throw new Error( 'Element is not a radio button.' );
      if ( ! el.checked ) {
        el.click();
      }
      return { radio: command.selector, checked: el.checked };
    }

    // ── select: choose an <option> in a <select> ─────────────────────────────
    if ( type === 'select' ) {
      const el = getElement( command.selector );
      if ( el.tagName.toLowerCase() !== 'select' ) throw new Error( 'Element is not a <select>.' );

      let found = false;
      for ( const opt of el.options ) {
        // Match by value or by visible text
        if ( opt.value === String( command.value ) || opt.text === String( command.value ) ) {
          opt.selected = true;
          found = true;
          break;
        }
      }
      if ( ! found ) throw new Error( `Option "${command.value}" not found in ${command.selector}` );

      el.dispatchEvent( new Event( 'change', { bubbles: true } ) );
      return { selected: command.value, selector: command.selector };
    }

    // ── navigate: change current tab URL ─────────────────────────────────────
    if ( type === 'navigate' ) {
      window.location.href = command.url;
      return { navigating_to: command.url };
    }

    // ── eval: run arbitrary JS in the page (use with care) ────────────────────
    if ( type === 'eval' ) {
      // eslint-disable-next-line no-eval
      const result = eval( command.code ); // jshint ignore:line
      return { eval_result: String( result ) };
    }

    throw new Error( `Unknown command type: ${type}` );

  } catch ( e ) {
    return { error: e.message };
  }
}