// ==UserScript==
// @name         API Key Test
// @namespace    api-key-test
// @version      1.1
// @description  Verifies that a Torn API key is available (TornPDA injection or desktop localStorage).
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/API_Test.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/meta/API_Test.meta.js
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

// ============================================================================
// API Key Test — Overview
// ============================================================================
//
// Purpose:
//   Confirms that a Torn API key is reachable from this script. On TornPDA the
//   key is injected automatically as "###PDA-APIKEY###". On desktop browsers
//   the user can store their key in localStorage under the key below, or set it
//   from the browser console with:
//
//       localStorage.setItem("tornpda_api_key_test", "YOUR_API_KEY_HERE")
//
//   Then reload the page and this script will report whether a valid-looking
//   16-character hex key was found.
//
// What it does:
//   1. Resolves the API key from TornPDA injection or localStorage.
//   2. Validates the key against a 16-character hex pattern.
//   3. Logs the result to the browser console.
//
// Files changed:
//   None (read-only diagnostic).
//
// ============================================================================

(function () {
    "use strict";

    // Storage key used on desktop browsers when TornPDA does not inject a key.
    const STORAGE_KEY = "tornpda_api_key_test";

    // -----------------------------------------------------------------------
    // resolveApiKey()
    //   Returns the Torn API key from TornPDA injection ("###PDA-APIKEY###")
    //   or falls back to a value stored in localStorage by the user. Returns
    //   null when no usable key is available.
    // -----------------------------------------------------------------------
    function resolveApiKey() {
        const inlineKey = "###PDA-APIKEY###";
        if (inlineKey && !inlineKey.includes("###") && inlineKey.length >= 10) {
            return inlineKey;
        }
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && stored.length >= 10) return stored;
        } catch (_) {}
        return null;
    }

    // -----------------------------------------------------------------------
    // isValidKey(key)
    //   Returns true when the key looks like a valid Torn API key (16 hex chars).
    // -----------------------------------------------------------------------
    function isValidKey(key) {
        return /^[a-f0-9]{16}$/i.test(key);
    }

    const API_KEY = resolveApiKey();

    console.log(
        "[API Key Test] API key available:",
        Boolean(API_KEY),
        "| Placeholder replaced (valid format):",
        isValidKey(API_KEY)
    );

    if (!API_KEY) {
        console.log(
            "[API Key Test] No API key found. Desktop users can store one with:" +
            "\n  localStorage.setItem(\"" + STORAGE_KEY + "\", \"YOUR_API_KEY_HERE\")" +
            "\nThen reload the page."
        );
    }
})();
