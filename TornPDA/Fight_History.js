// ==UserScript==
// @name         Torn Final-Hit History
// @namespace    tornpda-final-hit-history
// @version      1.3.0
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/Fight_History.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/meta/Fight_History.meta.js
// @description  Tracks live trophy-marked fight log entries locally.
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const PREFIX = "[Final Hit History]";
    const STORAGE_KEY = "tornpda_final_hit_history_v1";
    const MAX_ENTRIES = 20;
    const BUTTON_ID = "torn-fhh-button";
    const PANEL_ID = "torn-fhh-panel";
    const STYLE_ID = "torn-fhh-style";
    const WAKE_BUTTON_ID = "torn-fhh-wake-button";

    if (window.__tornFinalHitHistoryInitialized) return;
    window.__tornFinalHitHistoryInitialized = true;

    let observer = null;
    let scanTimer = null;
    let panelOpen = false;
    let keepScreenOn = false;
    let screenWakeLock = null;
    let previousPage = location.href;
    let baselineEstablished = false;
    let previousEntries = new Map();
    let lastSaved = new Map();

    function isSupportedPage() {
        const url = new URL(location.href);
        const path = url.pathname.toLowerCase();
        const sid = (url.searchParams.get("sid") || "").toLowerCase();

        return (
            (path.endsWith("/page.php") && sid === "attack") ||
            path.endsWith("/profiles.php") ||
            path.endsWith("/profile.php")
        );
    }

    function getPageIdentity() {
        const url = new URL(location.href);
        return (
            url.searchParams.get("user2ID") ||
            url.searchParams.get("XID") ||
            url.searchParams.get("userID") ||
            ""
        );
    }

    function getTCTTimestamp() {
        const now = new Date();
        const date = new Intl.DateTimeFormat("en-CA", {
            timeZone: "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(now);

        const time = new Intl.DateTimeFormat("en-GB", {
            timeZone: "UTC",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        }).format(now);

        return {
            iso: now.toISOString(),
            display: `${date} ${time} TCT`
        };
    }

    function loadEntries() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            const entries = data ? JSON.parse(data) : [];
            return Array.isArray(entries) ? entries : [];
        } catch (error) {
            console.error(PREFIX, "Unable to read history.", error);
            return [];
        }
    }

    function saveEntries(entries) {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(entries.slice(0, MAX_ENTRIES))
            );
            return true;
        } catch (error) {
            console.error(PREFIX, "Unable to save history.", error);
            return false;
        }
    }

    function cleanText(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
    }

    function getElementText(element) {
        return cleanText(element.innerText || element.textContent || "");
    }

    function looksLikeTrophy(element) {
        const values = [
            element.getAttribute("alt"),
            element.getAttribute("title"),
            element.getAttribute("aria-label"),
            element.getAttribute("data-testid"),
            element.getAttribute("src"),
            element.getAttribute("class"),
            element.getAttribute("href")
        ];

        if (element.outerHTML) {
            values.push(element.outerHTML.slice(0, 700));
        }

        return /trophy|winner|winning|victory|final.?hit/i.test(
            values.filter(Boolean).join(" ")
        );
    }

    function findLogRow(icon) {
        let element = icon.parentElement;
        let fallback = null;

        for (let depth = 0; element && depth < 10; depth++) {
            const text = getElementText(element);

            if (text.length >= 12 && text.length <= 450) {
                const tag = element.tagName.toLowerCase();
                const role = element.getAttribute("role") || "";
                const classes = typeof element.className === "string"
                    ? element.className
                    : "";

                if (
                    tag === "tr" ||
                    tag === "li" ||
                    tag === "article" ||
                    role === "row" ||
                    /action|event|log|history|battle|outcome/i.test(classes)
                ) {
                    return element;
                }

                if (!fallback) fallback = element;
            }

            element = element.parentElement;
        }

        return fallback;
    }

    function getTrophyEntries() {
        const elements = document.querySelectorAll(
            "img, svg, [role='img'], [aria-label], [title], [data-testid]"
        );

        const byRow = new Map();

        for (const icon of elements) {
            if (!looksLikeTrophy(icon)) continue;

            const row = findLogRow(icon);
            if (!row) continue;

            const text = getElementText(row);
            if (text.length < 12 || text.length > 450) continue;

            byRow.set(row, text);
        }

        return byRow;
    }

    function recordEntry(action) {
        const timestamp = getTCTTimestamp();
        const pageIdentity = getPageIdentity();
        const entries = loadEntries();
        const dedupeKey = `${pageIdentity}|${action}`;
        const lastTime = lastSaved.get(dedupeKey);

        if (lastTime && Date.now() - lastTime < 15000) {
            return false;
        }

        const entry = {
            key: `${timestamp.iso}|${pageIdentity}|${action}`,
            timestamp: timestamp.iso,
            timestampTCT: timestamp.display,
            action,
            pageIdentity,
            pageUrl: location.href
        };

        entries.unshift(entry);
        while (entries.length > MAX_ENTRIES) entries.pop();

        if (!saveEntries(entries)) return false;

        lastSaved.set(dedupeKey, Date.now());

        if (lastSaved.size > 100) {
            const cutoff = Date.now() - 60000;
            for (const [key, time] of lastSaved) {
                if (time < cutoff) lastSaved.delete(key);
            }
        }

        console.info(PREFIX, "Recorded final hit:", action);

        if (panelOpen) renderPanel();
        return true;
    }

    function resetBaseline() {
        baselineEstablished = false;
        previousEntries = new Map();
    }

    function scanFightLog() {
        if (!isSupportedPage()) return;

        if (previousPage !== location.href) {
            previousPage = location.href;
            resetBaseline();
        }

        const currentEntries = getTrophyEntries();

        if (!baselineEstablished) {
            if (currentEntries.size > 0) {
                previousEntries = new Map(currentEntries);
                baselineEstablished = true;
                console.info(
                    PREFIX,
                    "Baseline established with",
                    currentEntries.size,
                    "trophy row(s)."
                );
            }
            return;
        }

        for (const [row, text] of currentEntries) {
            const oldText = previousEntries.get(row);

            if (oldText === undefined) {
                const alreadyVisible = Array.from(previousEntries.values())
                    .includes(text);

                if (!alreadyVisible) recordEntry(text);
            } else if (oldText !== text) {
                recordEntry(text);
            }
        }

        const oldTexts = new Set(previousEntries.values());
        const newTexts = new Set(currentEntries.values());

        for (const text of newTexts) {
            if (!oldTexts.has(text)) {
                const alreadyHandled = Array.from(currentEntries.entries())
                    .some(([row, rowText]) =>
                        rowText === text && previousEntries.has(row)
                    );

                if (!alreadyHandled) recordEntry(text);
            }
        }

        previousEntries = new Map(currentEntries);
    }

    function scheduleScan() {
        if (scanTimer) clearTimeout(scanTimer);

        scanTimer = setTimeout(() => {
            scanTimer = null;
            scanFightLog();
        }, 150);
    }

    function startObserver() {
        if (observer) observer.disconnect();
        if (!document.body) return;

        observer = new MutationObserver(scheduleScan);

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
                "src", "alt", "title", "aria-label",
                "class", "data-testid", "href"
            ]
        });
    }

    async function enableScreenWakeLock() {
        if (screenWakeLock) {
            keepScreenOn = true;
            updateWakeButton();
            return;
        }

        if (!isSupportedPage()) return;

        if (!navigator.wakeLock ||
            typeof navigator.wakeLock.request !== "function") {
            alert("Screen wake lock is not supported by this browser.");
            keepScreenOn = false;
            updateWakeButton();
            return;
        }

        try {
            const lock = await navigator.wakeLock.request("screen");
            screenWakeLock = lock;
            keepScreenOn = true;

            lock.addEventListener("release", () => {
                if (screenWakeLock === lock) screenWakeLock = null;
                updateWakeButton();
            });

            updateWakeButton();
            console.info(PREFIX, "Screen wake lock enabled.");
        } catch (error) {
            keepScreenOn = false;
            screenWakeLock = null;
            updateWakeButton();
            alert("Could not keep the screen awake. Check browser support.");
            console.warn(PREFIX, "Wake lock request failed:", error);
        }
    }

    async function disableScreenWakeLock() {
        keepScreenOn = false;
        const lock = screenWakeLock;
        screenWakeLock = null;

        if (lock) {
            try {
                await lock.release();
            } catch (error) {
                console.warn(PREFIX, "Wake lock release failed.", error);
            }
        }

        updateWakeButton();
    }

    function toggleScreenWakeLock() {
        if (keepScreenOn) disableScreenWakeLock();
        else enableScreenWakeLock();
    }

    function updateWakeButton() {
        const button = document.getElementById(WAKE_BUTTON_ID);
        if (!button) return;

        const active = keepScreenOn && screenWakeLock !== null;
        button.textContent = active
            ? "☀ Screen On: ON"
            : "☾ Screen On: OFF";
        button.style.background = active ? "#27632f" : "#303a42";
    }

    document.addEventListener("visibilitychange", () => {
        if (
            keepScreenOn &&
            isSupportedPage() &&
            document.visibilityState === "visible" &&
            !screenWakeLock
        ) {
            enableScreenWakeLock();
        }

        scheduleScan();
    });

    window.addEventListener("pagehide", () => {
        keepScreenOn = false;

        if (screenWakeLock) {
            const lock = screenWakeLock;
            screenWakeLock = null;
            lock.release().catch(() => {});
        }
    });

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${BUTTON_ID}, #${WAKE_BUTTON_ID} {
                position: fixed;
                right: 8px;
                z-index: 2147483000;
                border: 1px solid #8da8ba;
                border-radius: 8px;
                color: #fff;
                padding: 7px 9px;
                font: 600 12px/1.2 sans-serif;
                box-shadow: 0 2px 8px rgba(0,0,0,.55);
                cursor: pointer;
            }
            #${BUTTON_ID} {
                top: 8px;
                background: #17364a;
            }
            #${WAKE_BUTTON_ID} {
                top: 43px;
                background: #303a42;
            }
            #${PANEL_ID} {
                position: fixed;
                top: 78px;
                right: 8px;
                z-index: 2147483001;
                width: min(360px, calc(100vw - 16px));
                max-height: 65vh;
                overflow-y: auto;
                box-sizing: border-box;
                padding: 9px;
                border: 1px solid #6b8292;
                border-radius: 10px;
                background: #171a1d;
                color: #f5f5f5;
                box-shadow: 0 5px 18px rgba(0,0,0,.75);
                font: 12px/1.35 sans-serif;
            }
            #${PANEL_ID} * {
                box-sizing: border-box;
            }
            #${PANEL_ID} .fhh-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 7px;
            }
            #${PANEL_ID} .fhh-title {
                font-size: 14px;
                font-weight: 700;
                color: #fff;
            }
            #${PANEL_ID} .fhh-button {
                border: 1px solid #738795;
                border-radius: 6px;
                padding: 5px 8px;
                background: #303a42;
                color: #fff;
                font: inherit;
                cursor: pointer;
            }
            #${PANEL_ID} .fhh-entry {
                padding: 7px 0;
                border-top: 1px solid #454b50;
                overflow-wrap: anywhere;
            }
            #${PANEL_ID} .fhh-time {
                margin-bottom: 3px;
                color: #8fdaff;
                font-weight: 700;
            }
            #${PANEL_ID} .fhh-action {
                color: #f5f5f5;
            }
            #${PANEL_ID} .fhh-empty,
            #${PANEL_ID} .fhh-footer {
                color: #c4cbd0;
                padding: 6px 0;
            }
        `;
        document.head.appendChild(style);
    }

    function createButton() {
        if (!document.getElementById(BUTTON_ID)) {
            const button = document.createElement("button");
            button.id = BUTTON_ID;
            button.type = "button";
            button.textContent = "🏆 Fight History";

            button.addEventListener("click", () => {
                if (document.getElementById(PANEL_ID)) {
                    document.getElementById(PANEL_ID).remove();
                    panelOpen = false;
                } else {
                    panelOpen = true;
                    renderPanel();
                }
            });

            document.body.appendChild(button);
        }

        if (!document.getElementById(WAKE_BUTTON_ID)) {
            const wakeButton = document.createElement("button");
            wakeButton.id = WAKE_BUTTON_ID;
            wakeButton.type = "button";
            wakeButton.addEventListener("click", toggleScreenWakeLock);
            document.body.appendChild(wakeButton);
        }

        updateWakeButton();
    }

    function renderPanel() {
        document.getElementById(PANEL_ID)?.remove();

        const panel = document.createElement("div");
        panel.id = PANEL_ID;

        const header = document.createElement("div");
        header.className = "fhh-header";

        const title = document.createElement("div");
        title.className = "fhh-title";
        title.textContent = "🏆 Final-Hit History";

        const controls = document.createElement("div");

        const clearButton = document.createElement("button");
        clearButton.className = "fhh-button";
        clearButton.textContent = "Clear";
        clearButton.addEventListener("click", () => {
            if (!confirm("Clear all stored fight records?")) return;

            localStorage.removeItem(STORAGE_KEY);
            lastSaved.clear();
            renderPanel();
        });

        const closeButton = document.createElement("button");
        closeButton.className = "fhh-button";
        closeButton.textContent = "✕";
        closeButton.setAttribute("aria-label", "Close history");

        closeButton.addEventListener("click", () => {
            panel.remove();
            panelOpen = false;
        });

        controls.append(clearButton, closeButton);
        header.append(title, controls);
        panel.appendChild(header);

        const entries = loadEntries();

        if (!entries.length) {
            const empty = document.createElement("div");
            empty.className = "fhh-empty";
            empty.textContent =
                "No final hits recorded yet. Keep this page open while a fight log updates.";
            panel.appendChild(empty);
        } else {
            for (const entry of entries) {
                const card = document.createElement("div");
                card.className = "fhh-entry";

                const time = document.createElement("div");
                time.className = "fhh-time";
                time.textContent =
                    entry.timestampTCT || "Timestamp unavailable";

                const action = document.createElement("div");
                action.className = "fhh-action";
                action.textContent = entry.action || "Entry unavailable";

                card.append(time, action);
                panel.appendChild(card);
            }
        }

        const footer = document.createElement("div");
        footer.className = "fhh-footer";
        footer.textContent =
            `${entries.length}/${MAX_ENTRIES} records · Stored locally · No API calls`;
        panel.appendChild(footer);

        document.body.appendChild(panel);
    }

    function checkPageChange() {
        if (location.href === previousPage) return;

        previousPage = location.href;
        resetBaseline();

        if (!isSupportedPage()) {
            keepScreenOn = false;

            if (screenWakeLock) {
                const lock = screenWakeLock;
                screenWakeLock = null;
                lock.release().catch(() => {});
            }

            document.getElementById(BUTTON_ID)?.remove();
            document.getElementById(WAKE_BUTTON_ID)?.remove();
            document.getElementById(PANEL_ID)?.remove();
            panelOpen = false;
            return;
        }

        addStyles();
        createButton();
        scanFightLog();
    }

    function init() {
        if (!isSupportedPage()) return;

        addStyles();
        createButton();
        startObserver();
        scanFightLog();
        setInterval(() => {
            checkPageChange();
            if (isSupportedPage()) scanFightLog();
        }, 1000);

        console.info(PREFIX, "Live fight-log observer started.");
    }

    if (document.body) {
        init();
    } else {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    }
})();
