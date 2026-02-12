// utils.js — Shared utilities
const SETTINGS_KEY = 'brc_settings';

/**
 * Generate a cryptographically random Browser ID.
 * Format: brc<timestamp_hex><random_hex>
 */
export function generateBrowserId() {
  const ts  = Date.now().toString( 16 );
  const rnd = Array.from( crypto.getRandomValues( new Uint8Array( 8 ) ) )
                   .map( b => b.toString( 16 ).padStart( 2, '0' ) )
                   .join( '' );
  return `brc${ts}${rnd}`;
}

/**
 * Load settings from chrome.storage.local.
 * @returns {Promise<object>}
 */
export async function getSettings() {
  return new Promise( ( resolve ) => {
    chrome.storage.local.get( SETTINGS_KEY, ( data ) => {
      resolve( data[SETTINGS_KEY] || {} );
    } );
  } );
}

/**
 * Persist settings to chrome.storage.local.
 * @param {object} settings
 */
export async function saveSettings( settings ) {
  return new Promise( ( resolve ) => {
    chrome.storage.local.set( { [SETTINGS_KEY]: settings }, resolve );
  } );
}