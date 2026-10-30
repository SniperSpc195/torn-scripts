// ==UserScript==
// @name         Fight History DOM Debugger
// @namespace    tornpda-final-hit-history-debug
// @version      1.0.0
// @description  Locally inspects trophy markers and likely fight-log rows.
// @match        https://www.torn.com/page.php*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const PREFIX = "[Fight History Debug]";
    const BUTTON_ID = "fhh-debug-button";
    const PANEL_ID = "fhh-debug-panel";
    const STYLE_ID = "fhh-debug-style";
    const MARKER_PATTERN = /trophy|winner|winning|victory|final.?hit/i;
    const ROW_CLASS_PATTERN = /action|event|log|history|battle|outcome|attack|fight|combat/i;
    const ROW_TEXT_PATTERN = /\b(?:hit|hits|missed|misses|fired|fires|attacked|attacks|defeated|hospitalized|mugged|mugs|shot|struck|damaged|damage|punched|kicked|stabbed|slashed|used)\b/i;

    if (window.__fightHistoryDebuggerLoaded) return;
    window.__fightHistoryDebuggerLoaded = true;

    function isAttackPage() {
        const url = new URL(location.href);
        return url.pathname.toLowerCase().endsWith("/page.php") &&
            (url.searchParams.get("sid") || "").toLowerCase() === "attack";
    }

    function cleanText(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
    }

    function elementText(element) {
        return cleanText(element.innerText || element.textContent || "");
    }

    function classText(element) {
        if (typeof element.className === "string") return element.className;
        return element.className?.baseVal || "";
    }

    function describe(element) {
        if (!element) return null;
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : "";
        const classes = classText(element)
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 5)
            .map(name => `.${name}`)
            .join("");
        const text = elementText(element).slice(0, 180);
        return `${tag}${id}${classes} text=${JSON.stringify(text)}`;
    }

    function markerDescription(element) {
        const attributes = [
            "alt", "title", "aria-label", "data-testid", "src", "class", "href"
        ];
        const matches = [];

        for (const name of attributes) {
            const value = element.getAttribute(name) || "";
            if (value && MARKER_PATTERN.test(value)) {
                matches.push(`${name}=${JSON.stringify(value.slice(0, 160))}`);
            }
        }

        const markup = element.outerHTML || "";
        const match = markup.match(MARKER_PATTERN);
        if (match) {
            const index = markup.toLowerCase().indexOf(match[0].toLowerCase());
            matches.push(`outerHTML=${JSON.stringify(markup.slice(Math.max(0, index - 80), index + 120))}`);
        }

        return matches;
    }

    function findCurrentScriptRow(icon) {
        let element = icon.parentElement;
        let fallback = null;

        for (let depth = 0; element && depth < 10; depth++) {
            const text = elementText(element);
            if (text.length >= 12 && text.length <= 450) {
                const tag = element.tagName.toLowerCase();
                const role = element.getAttribute("role") || "";
                if (
                    tag === "tr" ||
                    tag === "li" ||
                    tag === "article" ||
                    role === "row" ||
                    ROW_CLASS_PATTERN.test(classText(element))
                ) {
                    return element;
                }
                if (!fallback) fallback = element;
            }
            element = element.parentElement;
        }

        return fallback;
    }

    function ancestorChain(element) {
        const chain = [];
        let current = element;
        for (let depth = 0; current && depth < 7; depth++) {
            chain.push(describe(current));
            current = current.parentElement;
        }
        return chain;
    }

    function findActionTimeTables() {
        return Array.from(document.querySelectorAll("table"))
            .map(table => {
                const headers = Array.from(table.querySelectorAll("th"))
                    .map(elementText)
                    .join(" ");
                return { table, headers };
            })
            .filter(({ headers }) => /\baction\b/i.test(headers) && /\btime\b/i.test(headers))
            .map(({ table, headers }) => ({
                headers,
                table: describe(table),
                rows: Array.from(table.querySelectorAll("tbody tr, tr"))
                    .slice(0, 20)
                    .map(describe)
            }));
    }

    function findSemanticContainers() {
        const selector = [
            '[class*="attack"]', '[class*="fight"]', '[class*="battle"]',
            '[class*="combat"]', '[class*="log"]', '[class*="action"]',
            '[id*="attack"]', '[id*="fight"]', '[id*="battle"]',
            '[id*="combat"]', '[id*="log"]', '[id*="action"]'
        ].join(",");

        return Array.from(document.querySelectorAll(selector))
            .filter(element => {
                const text = elementText(element);
                return text.length >= 20 && text.length <= 450;
            })
            .slice(0, 40)
            .map(element => ({
                element: describe(element),
                looksLikeCombatText: ROW_TEXT_PATTERN.test(elementText(element))
            }));
    }

    function scanPage() {
        const elements = document.querySelectorAll(
            "img, svg, [role='img'], [aria-label], [title], [data-testid]"
        );
        const markers = [];

        for (const element of elements) {
            const matchedBy = markerDescription(element);
            if (!matchedBy.length) continue;

            const row = findCurrentScriptRow(element);
            const rowText = row ? elementText(row) : "";
            markers.push({
                marker: describe(element),
                matchedBy,
                selectedRow: describe(row),
                selectedRowLooksLikeCombat: ROW_TEXT_PATTERN.test(rowText),
                ancestorChain: ancestorChain(element)
            });
        }

        const report = {
            page: location.href,
            attackPage: isAttackPage(),
            markerCount: markers.length,
            markers,
            actionTimeTables: findActionTimeTables(),
            semanticContainers: findSemanticContainers()
        };

        console.info(PREFIX, report);
        return report;
    }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${BUTTON_ID}, #${PANEL_ID}, #${PANEL_ID} * { box-sizing: border-box; }
            #${BUTTON_ID} {
                position: fixed; top: 105px; right: 8px; z-index: 2147483000;
                padding: 7px 10px; border: 1px solid #9aabba; border-radius: 6px;
                background: #27394b; color: #fff; font: 600 12px sans-serif;
            }
            #${PANEL_ID} {
                position: fixed; top: 140px; left: 8px; right: 8px; z-index: 2147483001;
                width: auto; max-width: 600px; max-height: 60vh; margin: 0 auto;
                overflow: auto; padding: 8px; border: 1px solid #9aabba; border-radius: 7px;
                background: #171a1d; color: #f4f6f8; font: 11px/1.35 monospace;
            }
            #${PANEL_ID} .fhh-debug-controls { display: flex; gap: 8px; margin-bottom: 8px; }
            #${PANEL_ID} button {
                padding: 6px 9px; border: 1px solid #9aabba; border-radius: 5px;
                background: #303a42; color: #fff; font: 600 12px sans-serif;
            }
            #${PANEL_ID} pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        `;
        document.head.appendChild(style);
    }

    function openPanel() {
        if (document.getElementById(PANEL_ID)) return;
        const panel = document.createElement("section");
        panel.id = PANEL_ID;

        const controls = document.createElement("div");
        controls.className = "fhh-debug-controls";
        const scanButton = document.createElement("button");
        scanButton.type = "button";
        scanButton.textContent = "Scan page";
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.textContent = "Close";
        controls.append(scanButton, closeButton);

        const output = document.createElement("pre");
        output.textContent = "Tap Scan page to inspect marker candidates and attack-log containers.";
        panel.append(controls, output);
        document.body.appendChild(panel);

        scanButton.addEventListener("click", () => {
            output.textContent = JSON.stringify(scanPage(), null, 2);
        });
        closeButton.addEventListener("click", () => panel.remove());
    }

    function initialize() {
        if (!isAttackPage()) return;
        addStyles();
        const button = document.createElement("button");
        button.id = BUTTON_ID;
        button.type = "button";
        button.textContent = "Log DOM Debug";
        button.addEventListener("click", openPanel);
        document.body.appendChild(button);
    }

    if (document.body) {
        initialize();
    } else {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    }
})();
