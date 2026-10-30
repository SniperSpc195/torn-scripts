// ==UserScript==
// @name         TornPDA - City Sell Price
// @namespace    tornpda-city-sell-price
// @version      4.1.1
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/City_Resale_Filter.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/meta/City_Resale_Filter.meta.js
// @description  Displays the city sell price beside items on the Item Market.
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const API_KEY = '###PDA-APIKEY###';
    const API_BASE = 'https://api.torn.com/v2/';
    const CACHE_KEY = 'tornpda_city_prices_v4';
    const CACHE_TIME = 24 * 60 * 60 * 1000;
    const TILE_SELECTOR = '[class*="itemTile___"]';

    let itemData = {};
    let running = false;

    function money(value) {
        return '$' + Math.round(value).toLocaleString('en-US');
    }

    function getNumber(value) {
        if (value === null || value === undefined) return null;
        const number = Number(String(value).replace(/[$,]/g, '').replace(/[^\d.-]/g, ''));
        return Number.isFinite(number) ? number : null;
    }

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

    function getTiles() {
        return Array.from(document.querySelectorAll(TILE_SELECTOR));
    }

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

    function removeCityPrice(tile) {
        const old = tile.querySelector('.pda-city-price');
        if (old) old.remove();
    }

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
