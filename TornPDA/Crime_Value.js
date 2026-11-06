// ==UserScript==
// @name         TornPDA Crime Reward Values
// @namespace    tornpda-crime-reward-values
// @version      4.5.0
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/Crime_Value.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/meta/Crime_Value.meta.js
// @description  Automatically displays crime reward market values in a compact top popup.
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    // TornPDA Crime Reward Values
    // Displays Torn API market values for items received from crimes in a
    // compact top-center popup. Works on both TornPDA and desktop browsers.
    // TornPDA injects the API key automatically; on desktop, store your key
    // in localStorage under "tornpda_crime_api_key". Prices are cached for
    // 24 hours so the popup still works offline or without an API key.

    // Prevent duplicate initialization on TornPDA SPA re-injection
    if (window.__crimeRewardValuesInitialized) return;
    window.__crimeRewardValuesInitialized = true;

    const PREFIX = "[Crime Values]";
    const STORAGE_KEY_PREFIX = "tornpda_crime_api_key";
    const CACHE_KEY = "tornpda_crime_item_prices_v1";
    const CACHE_TTL = 24 * 60 * 60 * 1000;
    const POLL_INTERVAL = 1000;

    function log(...args) {
        console.log(PREFIX, ...args);
    }

    // Selector fallbacks: Torn CSS module classes change on site deploys.
    // Try specific classes first, then attribute-based fallbacks.
    const RESULT_SELECTORS = [
        ".outcomeReward___aVKEh",
        '[class*="outcomeReward"]',
        '[class*="crime-outcome"]'
    ];
    const ITEM_SELECTORS = [
        ".rewards___m4tv6 img.torn-item",
        '[class*="rewards"] img.torn-item',
        'img.torn-item[src*="/items/"]'
    ];
    const ITEM_TILE_SELECTORS = [
        ".baseItemTileWrapper___tV9VZ",
        '[class*="baseItemTileWrapper"]'
    ];
    const TILE_COUNTER_SELECTORS = [
        ".tileCounterText___M9kgO",
        '[class*="tileCounterText"]'
    ];

    const POPUP_ID = "crv-popup";
    const STYLE_ID = "crv-popup-style";

    let prices = {};
    let pricesReady = false;
    let priceError = "";
    let activeSection = null;
    let refreshScheduled = false;
    let previousHref = location.href;
    let pageChangeTimer = null;

    const processed = new WeakMap();

    // API key: TornPDA injects the real key; desktop falls back to stored key
    function resolveApiKey() {
        const inlineKey = "###PDA-APIKEY###";
        if (inlineKey && !inlineKey.includes("###") && inlineKey.length >= 10) {
            return inlineKey;
        }
        try {
            const stored = localStorage.getItem(STORAGE_KEY_PREFIX);
            if (stored && stored.length >= 10) return stored;
        } catch (_) {}
        return null;
    }

    const API_KEY = resolveApiKey();

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${POPUP_ID} {
                position: fixed !important;
                z-index: 2147483647 !important;
                top: max(4px, env(safe-area-inset-top)) !important;
                left: 50% !important;
                transform: translateX(-50%) !important;
                width: calc(100% - 12px) !important;
                max-width: 340px !important;
                max-height: 20vh !important;
                overflow-y: auto !important;
                overscroll-behavior: contain !important;
                box-sizing: border-box !important;
                padding: 4px 7px !important;
                border: 1px solid #68788a !important;
                border-radius: 7px !important;
                background: #202630 !important;
                color: #f1f4f8 !important;
                box-shadow: 0 2px 7px rgba(0,0,0,.4) !important;
                font-family: Arial, sans-serif !important;
                font-size: 11px !important;
                line-height: 1.2 !important;
                pointer-events: auto !important;
            }
            #${POPUP_ID} * { box-sizing: border-box !important; }
            #${POPUP_ID} .crv-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
                margin: 0 0 2px;
                padding: 0 0 3px;
                border-bottom: 1px solid #485361;
            }
            #${POPUP_ID} .crv-heading {
                color: #fff;
                font-size: 12px;
                line-height: 1.2;
                font-weight: 700;
            }
            #${POPUP_ID} .crv-close {
                flex: 0 0 auto;
                min-width: 25px;
                min-height: 24px;
                border: 0;
                border-radius: 4px;
                padding: 1px 6px;
                background: #3b4654;
                color: #fff;
                font-size: 17px;
                line-height: 1;
                cursor: pointer;
            }
            #${POPUP_ID} .crv-line,
            #${POPUP_ID} .crv-total {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 6px;
                width: 100%;
                padding: 1px 0;
                line-height: 1.2;
            }
            #${POPUP_ID} .crv-name {
                flex: 1 1 auto;
                min-width: 0;
                overflow-wrap: anywhere;
                color: #e4eaf0;
            }
            #${POPUP_ID} .crv-price {
                flex: 0 0 auto;
                max-width: 48%;
                overflow-wrap: anywhere;
                text-align: right;
                color: #8fe0a0;
                font-weight: 700;
            }
            #${POPUP_ID} .crv-total {
                margin-top: 2px;
                padding-top: 3px;
                border-top: 1px solid #485361;
                font-weight: 700;
            }
            #${POPUP_ID} .crv-missing { color: #ffcc80; }
        `;
        document.head.appendChild(style);
    }

    function money(value) {
        return "$" + Math.round(value).toLocaleString("en-US");
    }

    function readCache() {
        try {
            const data = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
            if (
                data &&
                data.prices &&
                data.time &&
                Date.now() - data.time < CACHE_TTL
            ) {
                return data.prices;
            }
        } catch (_) {}
        return null;
    }

    function findElements(root, selectors) {
        for (const sel of selectors) {
            try {
                const found = root.querySelectorAll(sel);
                if (found.length > 0) return Array.from(found);
            } catch (_) {}
        }
        return [];
    }

    function findElement(root, selectors) {
        for (const sel of selectors) {
            try {
                const found = root.querySelector(sel);
                if (found) return found;
            } catch (_) {}
        }
        return null;
    }

    function matchesAny(node, selectors) {
        for (const sel of selectors) {
            try {
                if (node.matches(sel)) return true;
            } catch (_) {}
        }
        return false;
    }

    function closestAny(element, selectors) {
        if (!element || !element.closest) return null;
        for (const sel of selectors) {
            try {
                const found = element.closest(sel);
                if (found) return found;
            } catch (_) {}
        }
        return null;
    }

    async function loadPrices() {
        const cached = readCache();
        if (cached) {
            prices = cached;
            pricesReady = true;
            log("Prices from cache:", Object.keys(prices).length, "items");
            updatePopup();
            return;
        }

        if (!API_KEY) {
            priceError = "No API key available (set it in TornPDA or localStorage)";
            pricesReady = true;
            updatePopup();
            return;
        }

        try {
            const response = await fetch(
                "https://api.torn.com/torn/?selections=items&key=" +
                encodeURIComponent(API_KEY)
            );
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }

            const data = await response.json();
            if (data.error) {
                throw new Error("Torn API error " + data.error.code);
            }

            const fresh = {};
            for (const id in (data.items || {})) {
                const raw = data.items[id].market_value;
                const value = Number(raw);
                if (
                    raw !== null &&
                    raw !== undefined &&
                    raw !== "" &&
                    Number.isFinite(value) &&
                    value > 0
                ) {
                    fresh[id] = value;
                }
            }

            prices = fresh;
            pricesReady = true;
            log("Prices from API:", Object.keys(prices).length, "items");

            try {
                localStorage.setItem(
                    CACHE_KEY,
                    JSON.stringify({ time: Date.now(), prices })
                );
            } catch (_) {}

            updatePopup();
        } catch (error) {
            priceError = error.message || "Unable to load prices";
            pricesReady = true;
            log("Price load failed:", priceError);
            updatePopup();
        }
    }

    function getRewards(section) {
        const found = new Map();
        const imgs = findElements(section, ITEM_SELECTORS);

        imgs.forEach(img => {
            const src = img.getAttribute("src") || "";
            const match = src.match(/\/items\/(\d+)\//);
            if (!match) return;

            const id = match[1];
            const alt = (img.getAttribute("alt") || "").trim();
            const quantityMatch = alt.match(/,\s*(\d+)\s*$/);
            const tile = closestAny(img, ITEM_TILE_SELECTORS);

            let quantity = quantityMatch
                ? parseInt(quantityMatch[1], 10)
                : 1;

            if (!quantityMatch && tile) {
                const counter = findElement(tile, TILE_COUNTER_SELECTORS);
                const parsed = counter
                    ? parseInt(counter.textContent.trim(), 10)
                    : 1;
                if (Number.isFinite(parsed) && parsed > 0) {
                    quantity = parsed;
                }
            }

            const name = quantityMatch
                ? alt.replace(/,\s*\d+\s*$/, "").trim()
                : alt || "Item #" + id;

            if (found.has(id)) {
                found.get(id).quantity += quantity;
            } else {
                found.set(id, { id, name, quantity });
            }
        });

        return Array.from(found.values());
    }

    function signature(rewards) {
        return rewards
            .map(item => item.id + ":" + item.quantity)
            .sort()
            .join("|");
    }

    function closePopup() {
        const el = document.getElementById(POPUP_ID);
        if (el) el.remove();
        activeSection = null;
    }

    function addLine(parent, nameText, valueText, missing = false) {
        const row = document.createElement("div");
        row.className = "crv-line";

        const name = document.createElement("span");
        name.className = "crv-name";
        name.textContent = nameText;

        const value = document.createElement("span");
        value.className = missing ? "crv-missing" : "crv-price";
        value.textContent = valueText;

        row.append(name, value);
        parent.appendChild(row);
    }

    function renderPopup() {
        if (!activeSection || !activeSection.isConnected) {
            closePopup();
            return;
        }

        const rewards = getRewards(activeSection);
        if (!rewards.length) {
            closePopup();
            return;
        }

        let popup = document.getElementById(POPUP_ID);
        if (!popup) {
            popup = document.createElement("div");
            popup.id = POPUP_ID;
            popup.setAttribute("role", "dialog");
            popup.setAttribute("aria-label", "Reward market values");
            document.body.appendChild(popup);
        }

        popup.replaceChildren();

        const header = document.createElement("div");
        header.className = "crv-header";

        const heading = document.createElement("div");
        heading.className = "crv-heading";
        heading.textContent = "Reward Values";

        const close = document.createElement("button");
        close.className = "crv-close";
        close.textContent = "✕";
        close.addEventListener("click", closePopup);

        header.append(heading, close);
        popup.appendChild(header);

        let total = 0;
        let missing = false;

        rewards.forEach(item => {
            const price = prices[item.id];
            const row = document.createElement("div");
            row.className = "crv-line";

            const name = document.createElement("span");
            name.className = "crv-name";
            name.textContent = item.name;

            const value = document.createElement("span");
            if (price != null) {
                value.className = "crv-price";
                value.textContent = money(price * item.quantity);
                total += price * item.quantity;
            } else {
                value.className = "crv-missing";
                value.textContent = "Unavailable";
                missing = true;
            }

            row.append(name, value);
            popup.appendChild(row);
        });

        const totalRow = document.createElement("div");
        totalRow.className = "crv-total";

        const totalLabel = document.createElement("span");
        totalLabel.className = "crv-name";
        totalLabel.textContent = missing ? "Known value" : "Total value";

        const totalAmount = document.createElement("span");
        totalAmount.className = "crv-price";
        totalAmount.textContent = money(total);

        totalRow.append(totalLabel, totalAmount);
        popup.appendChild(totalRow);

        if (missing) {
            const note = document.createElement("div");
            note.className = "crv-missing";
            note.textContent = "Some prices unavailable; total is incomplete.";
            popup.appendChild(note);
        }
    }

    function updatePopup() {
        if (activeSection) renderPopup();
    }

    function openPopup(section) {
        if (!section || !section.isConnected) return;
        if (!getRewards(section).length) return;

        activeSection = section;
        renderPopup();
    }

    function inspectSection(section) {
        if (!section || !section.isConnected) return;

        const rewards = getRewards(section);
        if (!rewards.length) return;

        const key = signature(rewards);
        if (processed.get(section) === key) return;

        processed.set(section, key);
        openPopup(section);
    }

    function inspectNode(node) {
        if (!node || node.nodeType !== 1) return;

        if (matchesAny(node, RESULT_SELECTORS)) {
            inspectSection(node);
        }

        if (node.querySelectorAll) {
            findElements(node, RESULT_SELECTORS).forEach(inspectSection);
        }
    }

    function scheduleInspect() {
        if (refreshScheduled) return;
        refreshScheduled = true;

        requestAnimationFrame(() => {
            refreshScheduled = false;
            findElements(document, RESULT_SELECTORS).forEach(inspectSection);

            if (activeSection && !activeSection.isConnected) {
                closePopup();
            }
        });
    }

    const observer = new MutationObserver(mutations => {
        let shouldInspect = false;

        for (const mutation of mutations) {
            const target = mutation.target.nodeType === 1
                ? mutation.target
                : mutation.target.parentElement;

            if (target && target.closest && target.closest("#" + POPUP_ID)) {
                continue;
            }

            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;

                if (
                    matchesAny(node, RESULT_SELECTORS) ||
                    findElement(node, RESULT_SELECTORS) ||
                    matchesAny(node, ITEM_SELECTORS) ||
                    findElement(node, ITEM_SELECTORS)
                ) {
                    inspectNode(node);
                    shouldInspect = true;
                }
            }

            if (mutation.removedNodes.length && activeSection) {
                shouldInspect = true;
            }
        }

        if (shouldInspect) scheduleInspect();
    });

    function startPageWatcher() {
        if (pageChangeTimer) return;
        pageChangeTimer = setInterval(() => {
            if (location.href === previousHref) return;
            previousHref = location.href;

            closePopup();
            processed.clear();

            scheduleInspect();
        }, POLL_INTERVAL);
    }

    function stopPageWatcher() {
        if (pageChangeTimer) {
            clearInterval(pageChangeTimer);
            pageChangeTimer = null;
        }
    }

    function init() {
        addStyles();
        loadPrices();

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        scheduleInspect();
        startPageWatcher();

        log("Initialized. API key:", API_KEY ? "present" : "missing (cache only)");
    }

    if (document.body) {
        init();
    } else {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    }
})();
