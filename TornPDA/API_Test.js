// ==UserScript==
// @name         API Key Test
// @namespace    api-key-test
// @version      1.0
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/API_Test.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/meta/API_Test.meta.js
// @match        https://www.torn.com/*
// @run-at       document-end
// ==/UserScript==

(function () {
    "use strict";

    const testKey = "###PDA-APIKEY###";

    console.log(
        "[API Key Test] Placeholder replaced:",
        /^[a-f0-9]{16}$/i.test(testKey)
    );
})();
