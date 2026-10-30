// ==UserScript==
// @name         TornPDA Drug Trade Route Optimizer
// @namespace    tornpda-drug-trade-route-optimizer
// @version      1.4.0
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/Travel_Profit_Optimizer.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/meta/Travel_Profit_Optimizer.meta.js
// @description  Drug price comparisons and optimized travel trade routes.
// @match        https://www.torn.com/page.php*
// @grant        GM_xmlhttpRequest
// @connect      yata.yt
// @connect      api.prombot.co.uk
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    const PREFIX = "[Drug Route Optimizer]";
    const CACHE_KEY = "tornpda_drug_route_optimizer_v1";
    const QUANTITY_KEY = "tornpda_drug_route_quantity_v1";
    const CACHE_TTL = 15 * 60 * 1000;
    const STALE_TTL = 30 * 60 * 1000;
    const YATA_URL = "https://yata.yt/api/v1/travel/export/";
    const PROM_URL = "https://api.prombot.co.uk/api/travel";
    const PANEL_ID = "tdro-panel-v140";

    const COUNTRIES = [
        { code: "mex", name: "Mexico", minutes: 17 },
        { code: "cay", name: "Cayman Islands", minutes: 23 },
        { code: "can", name: "Canada", minutes: 27 },
        { code: "haw", name: "Hawaii", minutes: 89 },
        { code: "uni", name: "United Kingdom", minutes: 106 },
        { code: "arg", name: "Argentina", minutes: 111 },
        { code: "swi", name: "Switzerland", minutes: 116 },
        { code: "jap", name: "Japan", minutes: 149 },
        { code: "chi", name: "China", minutes: 160 },
        { code: "uae", name: "United Arab Emirates", minutes: 180 },
        { code: "sou", name: "South Africa", minutes: 197 }
    ];

    const DRUG_NAMES = [
        "Cannabis", "Weed", "Ecstasy", "Ketamine", "LSD",
        "Opium", "PCP", "Shrooms", "Speed", "Vicodin", "Xanax"
    ];

    const DRUG_ALIASES = Object.fromEntries(
        DRUG_NAMES.map(name => [normalizeKey(name), name])
    );

    let panel = null;
    let allItems = {};
    let routes = [];
    let countryRankings = {};
    let selectedCountry = null;
    let lastRefresh = 0;
    let loading = false;
    let errorMessage = "";
    let observer = null;
    let destinationCheckTimer = null;

    function normalizeKey(value) {
        return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function log(...args) {
        console.log(PREFIX, ...args);
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;",
            '"': "&quot;", "'": "&#39;"
        })[char]);
    }

    function money(value) {
        if (!Number.isFinite(Number(value))) return "N/A";
        return "$" + Math.round(Number(value)).toLocaleString("en-US");
    }

    function ordinal(number) {
        const n = Math.abs(number);
        const lastTwo = n % 100;
        if (lastTwo >= 11 && lastTwo <= 13) return number + "th";
        return number + (
            n % 10 === 1 ? "st" :
            n % 10 === 2 ? "nd" :
            n % 10 === 3 ? "rd" : "th"
        );
    }

    function canonicalDrug(name) {
        return DRUG_ALIASES[normalizeKey(name)] || null;
    }

    function getCountry(code) {
        return COUNTRIES.find(country => country.code === code) || null;
    }

    function isTravelScreen() {
        if (!location.href.includes("torn.com/page.php")) return false;
        const params = new URLSearchParams(location.search);
        return ["travelagency", "travel"].includes(params.get("sid"));
    }

    function getSavedQuantity() {
        try {
            const saved = Number(localStorage.getItem(QUANTITY_KEY));
            return Number.isFinite(saved) && saved >= 1
                ? Math.min(10000, Math.floor(saved))
                : 1;
        } catch (_) {
            return 1;
        }
    }

    function saveQuantity(value) {
        const quantity = Math.max(1, Math.min(10000, Math.floor(Number(value) || 1)));
        try {
            localStorage.setItem(QUANTITY_KEY, String(quantity));
        } catch (error) {
            log("Could not save quantity.", error);
        }
        return quantity;
    }

    function requestJson(url) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") {
                reject(new Error("TornPDA GM_xmlhttpRequest is unavailable."));
                return;
            }

            GM_xmlhttpRequest({
                method: "GET",
                url,
                timeout: 15000,
                headers: { Accept: "application/json" },
                onload: response => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error("HTTP " + response.status));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (_) {
                        reject(new Error("Invalid JSON received."));
                    }
                },
                onerror: () => reject(new Error("Network request failed.")),
                ontimeout: () => reject(new Error("Request timed out."))
            });
        });
    }

    function readCache() {
        try {
            const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
            return cached && typeof cached === "object" ? cached : null;
        } catch (_) {
            return null;
        }
    }

    function writeCache(yata, prom) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                yata,
                prom
            }));
        } catch (error) {
            log("Could not save price cache.", error);
        }
    }

    function findCountryBlock(data, code) {
        if (!data || typeof data !== "object") return null;
        for (const container of [data.stocks, data.countries, data.travel, data.data, data]) {
            if (!container || typeof container !== "object") continue;
            const key = Object.keys(container).find(
                candidate => candidate.toLowerCase() === code
            );
            if (key) return container[key];
        }
        return null;
    }

    function extractItemArray(block) {
        if (Array.isArray(block)) return block;
        if (!block || typeof block !== "object") return [];
        for (const key of ["stocks", "items", "drugs", "stock", "data"]) {
            if (Array.isArray(block[key])) return block[key];
        }
        return [];
    }

    function parseFeed(data, sourceName) {
        const result = {};
        for (const country of COUNTRIES) {
            const block = findCountryBlock(data, country.code);
            result[country.code] = {};
            for (const item of extractItemArray(block)) {
                if (!item || typeof item !== "object") continue;
                const drugName = canonicalDrug(
                    item.name || item.item || item.drug || item.item_name
                );
                if (!drugName) continue;
                const cost = Number(
                    item.cost ?? item.price ?? item.buy_price ??
                    item.market_price ?? item.value
                );
                if (!Number.isFinite(cost) || cost <= 0) continue;
                const quantity = Number(
                    item.quantity ?? item.qty ?? item.stock ?? item.amount ?? 0
                );
                result[country.code][normalizeKey(drugName)] = {
                    id: String(item.id ?? item.item_id ?? normalizeKey(drugName)),
                    name: drugName,
                    cost,
                    quantity: Number.isFinite(quantity) ? quantity : 0,
                    source: sourceName
                };
            }
        }
        return result;
    }

    function buildCombinedItems(yataData, promData) {
        const yata = parseFeed(yataData, "YATA");
        const prom = parseFeed(promData, "Prometheus");
        const merged = {};
        for (const country of COUNTRIES) {
            merged[country.code] = {};
            for (const drugName of DRUG_NAMES) {
                const key = normalizeKey(drugName);
                const item = yata[country.code]?.[key] || prom[country.code]?.[key];
                if (item) merged[country.code][key] = { ...item, name: drugName };
            }
        }
        return merged;
    }

    function getDrugItem(countryCode, drugName) {
        return allItems?.[countryCode]?.[normalizeKey(drugName)] || null;
    }

    function getBuyPrice(countryCode, drugName) {
        const item = getDrugItem(countryCode, drugName);
        return item && item.cost > 0 ? item.cost : null;
    }

    function getSellPrice(countryCode, drugName) {
        const buy = getBuyPrice(countryCode, drugName);
        return buy === null ? null : buy * 0.75;
    }

    function getCheapestBuy(drugName) {
        return COUNTRIES.map(country => ({
            country,
            price: getBuyPrice(country.code, drugName)
        }))
        .filter(entry => entry.price !== null)
        .sort((a, b) => a.price - b.price)[0] || null;
    }

    function getBestSell(drugName) {
        return COUNTRIES.map(country => ({
            country,
            price: getSellPrice(country.code, drugName)
        }))
        .filter(entry => entry.price !== null)
        .sort((a, b) => b.price - a.price)[0] || null;
    }

    function buildCountryRankings() {
        const result = {};
        for (const country of COUNTRIES) {
            const entries = DRUG_NAMES.map(name => {
                const buy = getBuyPrice(country.code, name);
                const sell = getSellPrice(country.code, name);
                if (buy === null || sell === null) return null;
                const bestBuy = getCheapestBuy(name);
                const bestSell = getBestSell(name);
                return {
                    name,
                    buy,
                    sell,
                    bestBuy,
                    bestSell,
                    buyDifference: bestBuy ? Math.max(0, buy - bestBuy.price) : null,
                    sellDifference: bestSell ? Math.max(0, bestSell.price - sell) : null
                };
            }).filter(Boolean);
            entries.sort((a, b) => b.sell - a.sell || a.name.localeCompare(b.name));
            result[country.code] = entries.map((entry, index) => ({
                ...entry,
                rank: index + 1
            }));
        }
        return result;
    }

    function getQuantity() {
        const input = panel?.querySelector("#tdro-quantity");
        return saveQuantity(input?.value ?? getSavedQuantity());
    }

    function buildRoutes() {
        const result = [];
        const requestedQuantity = getQuantity();
        for (const origin of COUNTRIES) {
            for (const destination of COUNTRIES) {
                if (origin.code === destination.code) continue;
                for (const drugName of DRUG_NAMES) {
                    const originItem = getDrugItem(origin.code, drugName);
                    const destinationItem = getDrugItem(destination.code, drugName);
                    if (!originItem || !destinationItem) continue;
                    const buyPrice = originItem.cost;
                    const sellPrice = destinationItem.cost * 0.75;
                    const profitPerUnit = sellPrice - buyPrice;
                    if (!Number.isFinite(profitPerUnit) || profitPerUnit <= 0) continue;
                    const quantityAvailable = originItem.quantity > 0
                        ? originItem.quantity
                        : requestedQuantity;
                    const quantity = Math.max(1, Math.min(requestedQuantity, quantityAvailable));
                    const profit = profitPerUnit * quantity;
                    const minutes = origin.minutes * 2 + destination.minutes * 2 + 0.5;
                    const hourlyProfit = profit / (minutes / 60);
                    const cheapest = getCheapestBuy(drugName);
                    result.push({
                        drug: drugName,
                        origin,
                        destination,
                        buyPrice,
                        sellPrice,
                        quantity,
                        profitPerUnit,
                        profit,
                        minutes,
                        hourlyProfit,
                        buyStatus: !cheapest ? "unknown" :
                            originItem.cost <= cheapest.price ? "best" : "cheaper"
                    });
                }
            }
        }
        return result.sort((a, b) =>
            b.hourlyProfit - a.hourlyProfit || b.profit - a.profit
        );
    }

    function countryFromText(value) {
        const text = normalizeKey(value);
        if (!text) return null;
        const matches = COUNTRIES.filter(country =>
            text.includes(normalizeKey(country.name)) ||
            text === normalizeKey(country.code)
        );
        matches.sort((a, b) =>
            normalizeKey(b.name).length - normalizeKey(a.name).length
        );
        return matches[0]?.code || null;
    }

    function detectSelectedCountry() {
        const selectors = [
            '[class*="worldMap"] [aria-pressed="true"]',
            '[class*="worldMap"] [aria-selected="true"]',
            '[class*="worldMap"] [data-selected="true"]',
            '[class*="worldMap"] [class*="selected"]',
            'button[class*="destDropdownToggler"]',
            '[class*="destDropdownToggler"]'
        ];
        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                const candidate = [
                    element.getAttribute("aria-label"),
                    element.getAttribute("title"),
                    element.getAttribute("data-country"),
                    element.getAttribute("data-destination"),
                    element.textContent
                ].filter(Boolean).join(" ");
                const code = countryFromText(candidate);
                if (code) return code;
            }
        }
        for (const element of document.querySelectorAll(
            '[class*="worldMap"] [aria-label], [class*="worldMap"] img[alt]'
        )) {
            const isSelected =
                element.getAttribute("aria-pressed") === "true" ||
                element.getAttribute("aria-selected") === "true" ||
                element.getAttribute("data-selected") === "true" ||
                /selected|active/i.test(element.className?.baseVal || element.className || "");
            if (!isSelected) continue;
            const code = countryFromText(
                element.getAttribute("aria-label") ||
                element.getAttribute("alt") ||
                element.getAttribute("title")
            );
            if (code) return code;
        }
        return null;
    }

    function updateSelectedCountry() {
        const detected = detectSelectedCountry();
        if (!detected || detected === selectedCountry) return false;
        selectedCountry = detected;
        routes = buildRoutes();
        render();
        log("Selected destination changed to", getCountry(detected)?.name || detected);
        return true;
    }

    function getDataStatus() {
        if (loading) return "Refreshing price feeds…";
        if (errorMessage) return errorMessage;
        if (!Object.values(allItems).some(items => Object.keys(items || {}).length)) {
            return "No price data loaded.";
        }
        return "Selling prices are estimates at 75% of the listed foreign-shop price.";
    }

    function renderRankings() {
        const heading = panel.querySelector("#tdro-ranking-heading");
        const note = panel.querySelector("#tdro-ranking-note");
        const container = panel.querySelector("#tdro-rankings");
        if (!selectedCountry) {
            heading.textContent = "Drug Rankings";
            note.textContent = "Select a destination to view its prices.";
            container.innerHTML =
                '<div class="tdro-muted">Waiting for the selected destination to be detected.</div>';
            return;
        }
        const country = getCountry(selectedCountry);
        const entries = countryRankings[selectedCountry] || [];
        heading.textContent = `${country?.name || selectedCountry} — Drug Rankings`;
        note.textContent =
            "Buying and selling prices are for this country; better alternatives are shown below.";
        if (!entries.length) {
            container.innerHTML =
                '<div class="tdro-muted">No drug prices are available for this destination.</div>';
            return;
        }
        container.innerHTML = entries.map(entry => {
            const medal = entry.rank === 1 ? "🥇" :
                entry.rank === 2 ? "🥈" :
                entry.rank === 3 ? "🥉" : "";
            let buyComparison = "-";
            if (entry.bestBuy && entry.bestBuy.country.code !== selectedCountry && entry.buyDifference > 0) {
                buyComparison = `💰 ${escapeHtml(entry.bestBuy.country.name)} sells for ${money(entry.buyDifference)} less per unit`;
            }
            let sellComparison = "-";
            if (entry.bestSell && entry.bestSell.country.code !== selectedCountry && entry.sellDifference > 0) {
                sellComparison = `💰 ${escapeHtml(entry.bestSell.country.name)} will buy for ${money(entry.sellDifference)} more per unit`;
            }
            return `
                <div class="tdro-drug-entry">
                    <div class="tdro-drug-title">
                        <strong>${escapeHtml(entry.name)}</strong>
                        <span class="tdro-rank">${medal} ${ordinal(entry.rank)}</span>
                    </div>
                    <div class="tdro-price-line">Buying: <strong>${money(entry.buy)}</strong></div>
                    <div class="tdro-compare">${buyComparison}</div>
                    <div class="tdro-price-line">Selling: <strong>${money(entry.sell)}</strong></div>
                    <div class="tdro-compare">${sellComparison}</div>
                </div>
            `;
        }).join("");
    }

    function renderRoutes() {
        const container = panel.querySelector("#tdro-routes");
        const count = panel.querySelector("#tdro-route-count");
        const requestedQuantity = getQuantity();
        const visibleRoutes = selectedCountry
            ? routes.filter(route =>
                route.origin.code === selectedCountry ||
                route.destination.code === selectedCountry
            )
            : routes;
        count.textContent = `${visibleRoutes.length} profitable routes`;
        if (!visibleRoutes.length) {
            container.innerHTML = selectedCountry
                ? '<div class="tdro-muted">No profitable routes involving this destination were found with the current price data.</div>'
                : '<div class="tdro-muted">Select a destination to filter routes.</div>';
            return;
        }
        container.innerHTML = visibleRoutes.slice(0, 30).map((route, index) => {
            const quantity = Math.max(1, Math.min(requestedQuantity, route.quantity));
            const totalProfit = route.profitPerUnit * quantity;
            const hourlyProfit = totalProfit / (route.minutes / 60);
            let buyStatus;
            if (route.buyStatus === "best") {
                buyStatus = '<div class="tdro-good">✓ Best buying price — no country is cheaper</div>';
            } else if (route.buyStatus === "cheaper") {
                const cheapest = getCheapestBuy(route.drug);
                const saving = cheapest ? route.buyPrice - cheapest.price : 0;
                buyStatus = cheapest
                    ? `<div class="tdro-warning">⚠ ${escapeHtml(cheapest.country.name)} sells for ${money(saving)} less per unit</div>`
                    : '<div class="tdro-muted">Buying price comparison unavailable</div>';
            } else {
                buyStatus = '<div class="tdro-muted">Buying price comparison unavailable</div>';
            }
            return `
                <div class="tdro-route-entry">
                    <div class="tdro-route-title">
                        <strong>#${index + 1} ${escapeHtml(route.drug)}</strong>
                        <span class="tdro-profit">${money(totalProfit)}</span>
                    </div>
                    <div class="tdro-route-path">
                        Buy in <strong>${escapeHtml(route.origin.name)}</strong>
                        at ${money(route.buyPrice)} →
                        sell in <strong>${escapeHtml(route.destination.name)}</strong>
                        for ${money(route.sellPrice)} (estimated)
                    </div>
                    ${buyStatus}
                    <div class="tdro-route-details">
                        ${quantity.toLocaleString("en-US")} unit(s) ·
                        ${money(route.profitPerUnit)} per unit ·
                        ${route.minutes.toFixed(1)} min/rotation
                    </div>
                    <div class="tdro-route-hourly">
                        Estimated earnings: <strong>${money(totalProfit)}</strong>
                        · <strong>${money(hourlyProfit)}/hour</strong>
                    </div>
                </div>
            `;
        }).join("");
    }

    function render() {
        if (!panel) return;
        panel.querySelector("#tdro-status").textContent = getDataStatus();
        renderRankings();
        renderRoutes();
    }

    function injectStyles() {
        if (document.getElementById("tdro-styles-v140")) return;
        const style = document.createElement("style");
        style.id = "tdro-styles-v140";
        style.textContent = `
            #${PANEL_ID} {
                box-sizing: border-box; width: 100%; max-width: 100%;
                margin: 10px 0 14px; padding: 10px;
                color: #f2f5f8; background: #171b20;
                border: 1px solid #48525e; border-radius: 8px;
                font: 12px/1.4 Arial, sans-serif; overflow-wrap: anywhere;
            }
            #${PANEL_ID} * { box-sizing: border-box; }
            #${PANEL_ID} h3 {
                margin: 0 0 5px; color: #fff; font-size: 14px; line-height: 1.3;
            }
            #${PANEL_ID} .tdro-muted { color: #c0c9d3; font-size: 11px; }
            #${PANEL_ID} .tdro-status {
                margin: 0 0 9px; color: #c0c9d3; font-size: 10px;
            }
            #${PANEL_ID} .tdro-section {
                margin-top: 10px; padding-top: 9px; border-top: 1px solid #48525e;
            }
            #${PANEL_ID} .tdro-drug-entry,
            #${PANEL_ID} .tdro-route-entry {
                margin: 0; padding: 7px 0; border-bottom: 1px solid #39424c;
            }
            #${PANEL_ID} .tdro-drug-entry:last-child,
            #${PANEL_ID} .tdro-route-entry:last-child { border-bottom: 0; }
            #${PANEL_ID} .tdro-drug-title,
            #${PANEL_ID} .tdro-route-title {
                display: flex; align-items: baseline; justify-content: space-between;
                gap: 8px; margin-bottom: 3px; color: #fff;
            }
            #${PANEL_ID} .tdro-rank {
                flex-shrink: 0; color: #f5d77a; font-weight: 700;
            }
            #${PANEL_ID} .tdro-price-line { color: #f2f5f8; margin-top: 2px; }
            #${PANEL_ID} .tdro-compare {
                min-height: 14px; color: #ffd166; font-size: 11px; margin: 1px 0 3px;
            }
            #${PANEL_ID} .tdro-route-path { color: #e0e6ed; margin: 3px 0; }
            #${PANEL_ID} .tdro-route-details {
                color: #c0c9d3; font-size: 10px; margin-top: 3px;
            }
            #${PANEL_ID} .tdro-route-hourly { color: #f2f5f8; margin-top: 3px; }
            #${PANEL_ID} .tdro-profit, #${PANEL_ID} .tdro-good {
                color: #8fe3a2; font-weight: 700;
            }
            #${PANEL_ID} .tdro-warning {
                color: #ffd166; margin-top: 3px; font-size: 11px;
            }
            #${PANEL_ID} .tdro-controls {
                display: flex; align-items: center; flex-wrap: wrap;
                gap: 6px; margin: 7px 0;
            }
            #${PANEL_ID} input {
                width: 70px; max-width: 35%; padding: 5px; color: #fff;
                background: #252c34; border: 1px solid #657180;
                border-radius: 5px; font-size: 12px;
            }
            #${PANEL_ID} button {
                padding: 5px 8px; color: #fff; background: #354250;
                border: 1px solid #657180; border-radius: 5px; font-size: 11px;
            }
        `;
        document.head.appendChild(style);
    }

    function findTravelInsertionTarget() {
        const elements = Array.from(document.querySelectorAll("h1, h2, h3, h4, p, label, div, span"));
        const heading = elements.find(element => {
            if (element.closest("#" + PANEL_ID)) return false;
            if (element.children.length > 3) return false;
            const text = normalizeKey(element.textContent);
            return text.includes("selectdestinationandtravelingmethod");
        });
        if (heading) return heading;
        const toggler = document.querySelector('button[class*="destDropdownToggler"]');
        if (toggler) {
            return toggler.closest("section") ||
                toggler.closest("div") ||
                toggler.parentElement;
        }
        return null;
    }

    function createPanel() {
        const existing = document.getElementById(PANEL_ID);
        if (existing) {
            panel = existing;
            return panel;
        }
        injectStyles();
        panel = document.createElement("section");
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <h3>Drug Trade Route Optimizer</h3>
            <div id="tdro-status" class="tdro-status">Loading price data…</div>
            <div class="tdro-controls">
                <label for="tdro-quantity">Trade quantity:</label>
                <input id="tdro-quantity" type="number" min="1" max="10000"
                    step="1" value="${getSavedQuantity()}">
                <button id="tdro-refresh" type="button">Refresh prices</button>
            </div>
            <div class="tdro-section">
                <h3 id="tdro-ranking-heading">Drug Rankings</h3>
                <div id="tdro-ranking-note" class="tdro-muted">
                    Select a destination to view its prices.
                </div>
                <div id="tdro-rankings"></div>
            </div>
            <div class="tdro-section">
                <h3>Optimized Trade Routes</h3>
                <div id="tdro-route-count" class="tdro-muted">Calculating routes…</div>
                <div id="tdro-routes"></div>
            </div>
        `;
        const target = findTravelInsertionTarget();
        if (target && target.parentElement) {
            target.insertAdjacentElement("afterend", panel);
        } else {
            const main = document.querySelector("main") ||
                document.querySelector("#mainContainer") ||
                document.body;
            main.appendChild(panel);
        }
        panel.querySelector("#tdro-refresh").addEventListener("click", () => {
            refresh(true);
        });
        panel.querySelector("#tdro-quantity").addEventListener("input", event => {
            const quantity = saveQuantity(event.target.value);
            event.target.value = quantity;
            routes = buildRoutes();
            renderRoutes();
        });
        return panel;
    }

    async function refresh(force) {
        if (loading) return;
        loading = true;
        errorMessage = "";
        render();
        const cached = readCache();
        const cacheAge = cached?.timestamp ? Date.now() - cached.timestamp : Infinity;
        let yataData = cached?.yata || null;
        let promData = cached?.prom || null;
        if (!force && cacheAge < CACHE_TTL && yataData && promData) {
            allItems = buildCombinedItems(yataData, promData);
            countryRankings = buildCountryRankings();
            routes = buildRoutes();
            lastRefresh = cached.timestamp;
            loading = false;
            render();
            return;
        }
        try {
            const results = await Promise.allSettled([
                requestJson(YATA_URL),
                requestJson(PROM_URL)
            ]);
            if (results[0].status === "fulfilled") yataData = results[0].value;
            if (results[1].status === "fulfilled") promData = results[1].value;
            const freshFeedReceived = results.some(result => result.status === "fulfilled");
            if (!yataData && !promData) throw new Error("Both price feeds failed.");
            if (!freshFeedReceived && cacheAge > STALE_TTL) {
                throw new Error("Price feeds failed and cached data is too old.");
            }
            if (freshFeedReceived) {
                writeCache(yataData, promData);
                lastRefresh = Date.now();
            } else {
                lastRefresh = cached?.timestamp || 0;
            }
            allItems = buildCombinedItems(yataData, promData);
            if (!Object.values(allItems).some(items => Object.keys(items || {}).length)) {
                throw new Error("No recognized drug prices found in the feeds.");
            }
            countryRankings = buildCountryRankings();
            routes = buildRoutes();
        } catch (error) {
            log("Refresh failed:", error);
            if (cached?.yata || cached?.prom) {
                allItems = buildCombinedItems(cached.yata, cached.prom);
                countryRankings = buildCountryRankings();
                routes = buildRoutes();
                lastRefresh = cached.timestamp || 0;
                errorMessage = "Live refresh failed; showing cached prices.";
            } else {
                errorMessage = "Could not load prices. Check your connection and try Refresh prices.";
            }
        } finally {
            loading = false;
            updateSelectedCountry();
            render();
        }
    }

    function initialize() {
        if (!isTravelScreen()) return;
        createPanel();
        selectedCountry = detectSelectedCountry();
        refresh(false);
        if (observer) observer.disconnect();
        observer = new MutationObserver(() => {
            if (!document.getElementById(PANEL_ID)) {
                panel = null;
                createPanel();
                render();
            }
            updateSelectedCountry();
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                "aria-pressed", "aria-selected", "aria-label",
                "title", "class", "data-selected",
                "data-country", "data-destination"
            ]
        });
        if (destinationCheckTimer) clearInterval(destinationCheckTimer);
        destinationCheckTimer = setInterval(() => {
            if (!document.getElementById(PANEL_ID)) return;
            updateSelectedCountry();
            if (!loading && Date.now() - lastRefresh >= CACHE_TTL) {
                refresh(false);
            }
        }, 1500);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
