// ==UserScript==
// @name         Torn City Store Market RRP Highlighter
// @namespace    tornpda-store-rrp-highlighter
// @version      7.0.0
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/Item_RRP_for_City_Store.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/Item_RRP_for_City_Store.meta.js
// @description  Displays cached Torn API market values below city resale prices.
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    if (window.__storeRRPv7Running) return;
    window.__storeRRPv7Running = true;

    const PREFIX = "[Store RRP]";
    const API_KEY = "###PDA-APIKEY###";
    const API_URL = "https://api.torn.com/torn/?selections=items&key=";
    const CACHE_KEY = "store_rrp_market_value_v7";
    const RETRY_KEY = "store_rrp_market_value_v7_retry";
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
    const RETRY_COOLDOWN = 15 * 60 * 1000;
    const ROW_SELECTOR = ".sell-list-wrap ul.sell-items-list > li";
    const LABEL_CLASS = "store-rrp-market-value";

    let prices = {};
    let activeList = null;
    let listObserver = null;
    let pageObserver = null;
    let scanTimer = null;
    let initialized = false;
    let pricesLoaded = false;

    function log(...args) {
        console.log(PREFIX, ...args);
    }

    function normalizeName(name) {
        return String(name || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    }

    function formatMoney(value) {
        return "$" + Math.round(value).toLocaleString("en-US");
    }

    function validPrices(value) {
        if (!value || typeof value !== "object") return false;

        return Object.entries(value).some(function ([name, price]) {
            return name.length > 0 &&
                Number.isFinite(price) &&
                price >= 0;
        });
    }

    function readCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;

            const cache = JSON.parse(raw);
            if (
                !cache ||
                typeof cache.savedAt !== "number" ||
                cache.savedAt > Date.now() ||
                !validPrices(cache.prices)
            ) {
                return null;
            }

            return cache;
        } catch (error) {
            log("Cache read failed:", error.message);
            return null;
        }
    }

    function saveCache(newPrices) {
        try {
            localStorage.setItem(
                CACHE_KEY,
                JSON.stringify({ savedAt: Date.now(), prices: newPrices })
            );
        } catch (error) {
            log("Cache save failed:", error.message);
        }
    }

    function isCacheFresh(cache) {
        return !!cache && Date.now() - cache.savedAt < CACHE_TTL;
    }

    function retryIsCoolingDown() {
        try {
            const retryAt = Number(localStorage.getItem(RETRY_KEY) || 0);
            return retryAt > Date.now();
        } catch (_) {
            return false;
        }
    }

    function setRetryCooldown() {
        try {
            localStorage.setItem(RETRY_KEY, String(Date.now() + RETRY_COOLDOWN));
        } catch (_) {}
    }

    function clearRetryCooldown() {
        try {
            localStorage.removeItem(RETRY_KEY);
        } catch (_) {}
    }

    async function fetchPrices() {
        if (!API_KEY || API_KEY.includes("###") || API_KEY.length < 10) {
            throw new Error(
                "TornPDA did not inject a valid API key. " +
                "Check TornPDA's API-key settings."
            );
        }

        if (typeof PDA_httpGet !== "function") {
            throw new Error(
                "PDA_httpGet is unavailable. " +
                "Check that TornPDA is running this script."
            );
        }

        const response = await PDA_httpGet(API_URL + encodeURIComponent(API_KEY), {});
        if (!response || typeof response.responseText !== "string") {
            throw new Error("No readable response from the Torn API.");
        }

        let data;
        try {
            data = JSON.parse(response.responseText);
        } catch (_) {
            throw new Error("The Torn API response was not valid JSON.");
        }

        if (data.error) {
            throw new Error(
                "Torn API error " + data.error.code + ": " + data.error.error
            );
        }

        if (!data.items || typeof data.items !== "object") {
            throw new Error("The API response contained no item dataset.");
        }

        const result = {};
        for (const item of Object.values(data.items)) {
            if (!item || typeof item.name !== "string") continue;

            const name = normalizeName(item.name);
            const value = Number(item.market_value);
            if (
                name &&
                item.market_value !== null &&
                item.market_value !== undefined &&
                Number.isFinite(value) &&
                value >= 0
            ) {
                result[name] = value;
            }
        }

        if (!validPrices(result)) {
            throw new Error("No valid market_value prices were found.");
        }

        saveCache(result);
        clearRetryCooldown();
        log("Successfully refreshed market values:", Object.keys(result).length);
        return result;
    }

    async function loadPrices() {
        const cache = readCache();

        if (isCacheFresh(cache)) {
            prices = cache.prices;
            log("Using cached market values.");
            return;
        }

        if (retryIsCoolingDown()) {
            if (cache) {
                prices = cache.prices;
                log("API retry cooldown active; using cached prices.");
            } else {
                log("API retry cooldown active; no cached prices available.");
            }
            return;
        }

        try {
            prices = await fetchPrices();
        } catch (error) {
            setRetryCooldown();
            if (cache) {
                prices = cache.prices;
                log("Refresh failed; using cached prices:", error.message);
            } else {
                prices = {};
                log("Could not load market prices:", error.message);
            }
        }
    }

    function scanRows() {
        if (!activeList || !activeList.isConnected) return;

        const rows = activeList.querySelectorAll(":scope > li");
        let displayed = 0;

        for (const row of rows) {
            const item = row.querySelector("ul.item");
            if (!item) continue;

            const nameNode = item.querySelector(".name");
            const cityPrice = item.querySelector("li.value");
            if (!nameNode || !cityPrice) continue;

            const name = normalizeName(nameNode.textContent);
            if (!name) continue;

            let label = cityPrice.querySelector("." + LABEL_CLASS);
            if (label && label.dataset.itemName !== name) {
                label.remove();
                label = null;
            }

            const marketValue = prices[name];
            if (!Number.isFinite(marketValue)) {
                if (label) label.remove();
                continue;
            }

            const cityPriceText = Array.from(cityPrice.childNodes)
                .filter(node => !(node.nodeType === 1 && node.classList.contains(LABEL_CLASS)))
                .map(node => node.textContent)
                .join(" ");
            const cityValue = Number(cityPriceText.replace(/[^0-9.]/g, ""));

            if (!label) {
                label = document.createElement("div");
                label.className = LABEL_CLASS;
                label.dataset.itemName = name;
                label.style.cssText =
                    "display:block;" +
                    "margin-top:3px;" +
                    "font-size:10px;" +
                    "font-weight:600;" +
                    "line-height:1.3;";
                cityPrice.appendChild(label);
            }

            label.textContent = "Market RRP: " + formatMoney(marketValue);
            label.style.color =
                Number.isFinite(cityValue) && marketValue < cityValue
                    ? "#32cd32"
                    : "#4da6ff";
            displayed++;
        }

        log("Scan complete. Rows:", rows.length, "Prices displayed:", displayed);
    }

    function scheduleScan() {
        if (scanTimer !== null) clearTimeout(scanTimer);
        scanTimer = setTimeout(function () {
            scanTimer = null;
            scanRows();
        }, 200);
    }

    function bindList(list) {
        if (list === activeList) return;

        if (listObserver) {
            listObserver.disconnect();
            listObserver = null;
        }

        activeList = list;
        if (!list) return;
        if (pricesLoaded) scanRows();

        listObserver = new MutationObserver(function (records) {
            const relevant = records.some(function (record) {
                const target = record.target.nodeType === 1
                    ? record.target
                    : record.target.parentElement;
                if (target && target.closest && target.closest("." + LABEL_CLASS)) {
                    return false;
                }

                const changedNodes = [...record.addedNodes, ...record.removedNodes];
                return changedNodes.some(function (node) {
                    if (node.nodeType !== 1) return false;
                    if (node.classList && node.classList.contains(LABEL_CLASS)) {
                        return false;
                    }
                    return true;
                }) || record.type === "characterData";
            });

            if (relevant) scheduleScan();
        });

        listObserver.observe(list, {
            childList: true,
            subtree: true,
            characterData: true
        });

        log("Watching the Sell Items list.");
    }

    function checkForList() {
        const list = document.querySelector(".sell-list-wrap ul.sell-items-list");
        if (!list) return;

        bindList(list);
        if (!initialized) {
            initialized = true;
            log("Sell Items list found; loading prices.");
            loadPrices().then(function () {
                pricesLoaded = true;
                const currentList = document.querySelector(".sell-list-wrap ul.sell-items-list");
                if (currentList) bindList(currentList);
                scanRows();
            });
        }
    }

    function start() {
        checkForList();
        pageObserver = new MutationObserver(function () {
            checkForList();
        });
        pageObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.body) {
        start();
    } else {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    }
})();
