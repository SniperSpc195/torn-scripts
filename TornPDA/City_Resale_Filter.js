// ==UserScript==
// @name         TornPDA - City Sell Price
// @namespace    tornpda-city-sell-price
// @version      4.1.3
// @description  Displays the city sell price beside items on the Item Market.
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/City_Resale_Filter.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/meta/City_Resale_Filter.meta.js
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-end
// @grant        none
// ==/UserScript==

// ============================================================================
// TornPDA - City Sell Price — Overview
// ============================================================================
//
// Purpose:
//   Shows the Torn API city sell price next to each item on the Item Market
//   page, so you can quickly see whether the market price is above or below
//   what NPC city shops pay. Works on both TornPDA and desktop browsers.
//
// API key:
//   TornPDA injects the key automatically (###PDA-APIKEY###). Desktop users
//   can store their Torn API key in localStorage:
//
//       localStorage.setItem("tornpda_city_api_key", "YOUR_API_KEY_HERE")
//
//   Prices are cached for 24 hours, so the script keeps working after the
//   initial fetch even if the API key is later removed.
//
// What it does:
//   1. Adds a small "CITY $price" label to each item tile on the Item Market.
//   2. Labels are green when the market price is below the city sell price,
//      blue when it is above.
//   3. Caches item prices in localStorage for 24 hours.
//   4. Watches the page dynamically as you scroll/filter the market.
//
// Files changed:
//   None (read-only; writes only to localStorage cache).
//
// ============================================================================

(function () {
    'use strict';

    // Prevent duplicate initialization on TornPDA SPA re-injection.
    if (window.__cityResaleFilterInitialized) return;
    window.__cityResaleFilterInitialized = true;

    const STORAGE_KEY_PREFIX = "tornpda_city_api_key";

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
    const API_BASE = 'https://api.torn.com/v2/';
    const CACHE_KEY = 'tornpda_city_prices_v4';
    const CACHE_TIME = 24 * 60 * 60 * 1000;
    const TILE_SELECTOR = '[class*="itemTile___"]';

    let itemData = {};
    let running = false;

    function money(value) {
        return '$' + Math.round(value).toLocaleString('en-US');
    }

    // getNumber(value)
//   Strips currency formatting from a string and returns a number, or null
//   when the value cannot be parsed.
function getNumber(value) {
        if (value === null || value === undefined) return null;
        const number = Number(String(value).replace(/[$,]/g, '').replace(/[^\d.-]/g, ''));
        return Number.isFinite(number) ? number : null;
    }

// apiGet(url)
//   Fetches JSON from a URL using TornPDA's PDA_httpGet when available,
//   falling back to the native fetch API on desktop browsers.
async function apiGet(url) {
        if (typeof window.PDA_httpGet === 'function') {
            const response = await window.PDA_httpGet(url, {
                Accept: 'application/json'
            });
            if (response.status && response.status >= 400) {
                throw new Error('HTTP ' + response.status);
            }
            return JSON.parse(response.responseText);
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    }

// loadItems()
//   Loads item city prices from localStorage cache when fresh, otherwise
//   fetches them from the Torn API. Results are stored in the itemData
//   object and cached for 24 hours.
async function loadItems() {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const saved = JSON.parse(cached);
                if (saved.time && saved.items && Date.now() - saved.time < CACHE_TIME) {
                    itemData = saved.items;
                    return;
                }
            } catch (_) {}
        }

        if (!API_KEY) return;

        const url = API_BASE + 'torn/items?key=' + encodeURIComponent(API_KEY);
        const data = await apiGet(url);
        if (data.error) throw new Error(data.error.error || 'Torn API error');

        const source = Array.isArray(data.items)
            ? data.items
            : Object.values(data.items || {});
        const database = {};
        source.forEach(item => {
            if (!item || !item.id) return;
            const cityPrice = getCityPrice(item);
            if (cityPrice !== null && cityPrice > 0) {
                database[String(item.id)] = {
                    name: item.name || '',
                    cityPrice
                };
            }
        });

        itemData = database;
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            time: Date.now(),
            items: database
        }));
    }

// getCityPrice(item)
//   Finds a city shop sell price from a Torn API item object. Checks the
//   item's shop listings for anything containing "city", then falls back to
//   item-level sell_price fields. Returns the price or null.
function getCityPrice(item) {
    const shops = item.value && Array.isArray(item.value.shops)
        ? item.value.shops
        : Array.isArray(item.shops)
            ? item.shops
            : [];
    for (const shop of shops) {
        if (!JSON.stringify(shop).toLowerCase().includes('city')) continue;
        const possiblePrices = [shop.sell_price, shop.sellPrice, shop.price, shop.value, shop.sell];
        for (const value of possiblePrices) {
            const price = getNumber(value);
            if (price !== null && price > 0) return price;
        }
    }
    const oldPrice = getNumber(item.sell_price);
    if (oldPrice !== null && oldPrice > 0) return oldPrice;
    if (item.value) {
        for (const value of [item.value.sell_price, item.value.sellPrice]) {
            const price = getNumber(value);
            if (price !== null && price > 0) return price;
        }
    }
    return null;
}

// getTiles()
//   Returns all item market tile elements currently in the DOM.
function getTiles() {
    return Array.from(document.querySelectorAll(TILE_SELECTOR));
}

// getItemId(tile)
//   Extracts the Torn item ID from a market tile by inspecting image sources
//   and element attributes. Returns the ID string or null.
function getItemId(tile) {
    const images = tile.querySelectorAll('img');
    for (const img of images) {
        for (const source of [img.src, img.getAttribute('src'), img.getAttribute('data-src')]) {
            if (!source) continue;
            const match = source.match(/items\/(\d+)/);
            if (match) return match[1];
        }
    }
    for (const element of tile.querySelectorAll('*')) {
        for (const attribute of Array.from(element.attributes || [])) {
            if (/item.*id/i.test(attribute.name) && /^\d+$/.test(attribute.value)) {
                return attribute.value;
            }
        }
    }
    return null;
}

// getDisplayedMarketPrice(tile)
//   Reads the visible market price from a tile by looking for elements with
//   price/cost in their class name and extracting a dollar amount.
//   Skips elements inside our own CITY label.
function getDisplayedMarketPrice(tile) {
        const priceSelectors = ['[class*="price"]', '[class*="Price"]', '[class*="cost"]', '[class*="Cost"]'];
        for (const selector of priceSelectors) {
            for (const node of tile.querySelectorAll(selector)) {
                if (node.closest('.pda-city-price') || node.querySelector('.pda-city-price')) continue;
                const text = (node.innerText || node.textContent || '').trim();
                if (!text || !text.includes('$')) continue;
                const match = text.match(/\$\s*[\d,]+(?:\.\d+)?/);
                if (match) {
                    const price = getNumber(match[0]);
                    if (price !== null && price > 0) return price;
                }
            }
        }
        return null;
    }

// addCityPrice(tile, price)
//   Appends a "CITY $price" label to a market tile. Green when the city price
//   is below the market price, blue when above. Removes any existing label first.
function addCityPrice(tile, price) {
    const old = tile.querySelector('.pda-city-price');
    if (old) old.remove();
    const marketPrice = getDisplayedMarketPrice(tile);
    const label = document.createElement('div');
    label.className = 'pda-city-price';
    label.textContent = 'CITY ' + money(price);
    label.classList.add(
        marketPrice !== null && price < marketPrice
            ? 'pda-city-blue'
            : 'pda-city-green'
    );
    tile.appendChild(label);
}

// removeCityPrice(tile)
//   Removes any existing CITY price label from a tile.
function removeCityPrice(tile) {
    const old = tile.querySelector('.pda-city-price');
    if (old) old.remove();
}

// updateVisibleItems()
//   Scans all visible market tiles and adds/removes CITY price labels based
//   on cached item data. Guarded by the `running` flag to prevent overlapping passes.
function updateVisibleItems() {
    if (running) return;
    running = true;
    try {
        getTiles().forEach(tile => {
            const id = getItemId(tile);
            if (!id) {
                removeCityPrice(tile);
                return;
            }
            const data = itemData[String(id)];
            if (!data || !data.cityPrice) {
                removeCityPrice(tile);
                return;
            }
            addCityPrice(tile, data.cityPrice);
        });
    } finally {
        running = false;
    }
}

// addStyles()
//   Injects the CSS for CITY price labels into the document head. No-op if
//   the style element already exists.
function addStyles() {
    if (document.getElementById('pda-city-price-style')) return;
    const style = document.createElement('style');
    style.id = 'pda-city-price-style';
    style.textContent = `
        .pda-city-price {
            display: inline-block;
            box-sizing: border-box;
            margin: 2px 0 1px 4px;
            padding: 1px 3px;
            border-radius: 3px;
            background: #263238;
            border: 1px solid currentColor;
            font-size: 9px;
            font-weight: 700;
            line-height: 1.2;
            white-space: nowrap;
            position: relative;
            z-index: 100;
        }
        .pda-city-price.pda-city-green { color: #7CFF8B; }
        .pda-city-price.pda-city-blue { color: #4DA6FF; }
    `;
    document.head.appendChild(style);
}

// initialize()
//   Entry point: adds styles, waits for the item market root element to appear,
//   loads item prices, updates visible items, and sets up a MutationObserver
//   to react to dynamic market changes.
async function initialize() {
        addStyles();
        let attempts = 0;
        while (!document.querySelector('#item-market-root') && attempts < 40) {
            await new Promise(resolve => setTimeout(resolve, 250));
            attempts++;
        }
        if (!document.querySelector('#item-market-root')) return;
        try {
            await loadItems();
            updateVisibleItems();
        } catch (error) {
            console.error('[City Sell Price]', error);
        }
        const root = document.querySelector('#item-market-root');
        if (!root) return;
        let timer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => updateVisibleItems(), 150);
        });
        observer.observe(root, { childList: true, subtree: true });
    }

    initialize();
})();
