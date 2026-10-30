// ==UserScript==
 // @name         Torn 24-Hour Sales by Buyer
 // @namespace    torn-sales-by-buyer
 // @version      2.1.0
 // @downloadURL  https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/Bazaar%20Records.js
 // @updateURL    https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA/Bazaar%20Records.meta.js
 // @description  Bazaar sales totals grouped by buyer with clickable profiles.
 // @match        https://www.torn.com/*
 // @run-at       document-end
 // @grant        none
 // ==/UserScript==

 (function () {
     "use strict";

     if (window.__tornSalesByBuyerLoaded) return;
     window.__tornSalesByBuyerLoaded = true;

     const PDAKey = "###PDA-APIKEY###";
     const PREFIX = "[Sales by Buyer]";
     const PAGE_SIZE = 1000;

     let busy = false;
     let csvRows = [];
     let currentPage = "";
     const buyerNameCache = new Map();

     const style = document.createElement("style");
     style.textContent = `
       #sb-launch, #sb-panel, #sb-panel * {
         box-sizing: border-box !important;
         font-family: Arial, sans-serif !important;
       }
       #sb-launch {
         position: fixed !important;
         z-index: 2147483646 !important;
         top: 214px !important;
         right: 10px !important;
         padding: 8px 12px !important;
         background: #34465c !important;
         color: #fff !important;
         border: 1px solid #d1d9e5 !important;
         border-radius: 8px !important;
         font-size: 13px !important;
         font-weight: bold !important;
         box-shadow: 0 2px 8px #0009 !important;
       }
       #sb-panel {
         position: fixed !important;
         z-index: 2147483647 !important;
         top: 252px !important;
         left: 8px !important;
         right: 8px !important;
         width: auto !important;
         max-width: 600px !important;
         margin: 0 auto !important;
         max-height: calc(100dvh - 270px) !important;
         overflow-y: auto !important;
         overflow-x: hidden !important;
         padding: 12px !important;
         background: #17191d !important;
         color: #f5f5f5 !important;
         border: 1px solid #858b96 !important;
         border-radius: 10px !important;
         box-shadow: 0 4px 24px #000d !important;
         font-size: 14px !important;
         line-height: 1.4 !important;
         overscroll-behavior: contain !important;
       }
       #sb-panel * {
         max-width: 100%;
         overflow-wrap: anywhere;
       }
       #sb-panel button {
         padding: 8px 10px !important;
         background: #383e49 !important;
         color: #fff !important;
         border: 1px solid #aeb6c4 !important;
         border-radius: 6px !important;
         font-size: 13px !important;
       }
       #sb-panel button:disabled { opacity: .55 !important; }
       #sb-panel table {
         width: 100% !important;
         table-layout: fixed !important;
         border-collapse: collapse !important;
         background: #202329 !important;
         color: #fff !important;
         font-size: 12px !important;
       }
       #sb-panel th, #sb-panel td {
         padding: 6px 4px !important;
         border: 1px solid #555d69 !important;
         color: #f5f5f5 !important;
         text-align: left !important;
         overflow-wrap: anywhere !important;
         vertical-align: top !important;
       }
       #sb-panel th { background: #343a45 !important; }
       #sb-panel h3, #sb-panel h4, #sb-panel p,
       #sb-panel strong, #sb-panel span {
         color: #fff !important;
       }
       #sb-panel .sb-muted { color: #d1d5db !important; }
       #sb-panel .sb-total {
         background: #202c25 !important;
         border: 1px solid #55755f !important;
         border-radius: 7px !important;
         padding: 10px !important;
         margin: 10px 0 !important;
       }
       #sb-panel a.sb-profile {
         color: #8ecbff !important;
         text-decoration: underline !important;
         cursor: pointer !important;
       }
       @media (max-height: 700px) {
         #sb-panel {
           top: 245px !important;
           max-height: calc(100dvh - 255px) !important;
         }
       }
     `;
     document.head.appendChild(style);

     const money = n =>
         "$" + Math.round(n).toLocaleString("en-US");

     const fmtDate = ts =>
         new Date(ts * 1000).toLocaleString();

     function isLogPage() {
         const url = location.href.toLowerCase();
         return url.includes("sid=log") ||
                url.includes("logs.php") ||
                url.includes("/log.php");
     }

     function makeButton() {
         if (!isLogPage() || document.getElementById("sb-launch")) return;

         const button = document.createElement("button");
         button.id = "sb-launch";
         button.textContent = "Sales 24h";
         button.onclick = openPanel;
         document.body.appendChild(button);
     }

     function openPanel() {
         if (document.getElementById("sb-panel")) return;

         const panel = document.createElement("section");
         panel.id = "sb-panel";
         panel.innerHTML = `
           <div style="display:flex;align-items:center;
                       justify-content:space-between;gap:8px">
             <strong style="font-size:16px">Bazaar Sales · 24h</strong>
             <button id="sb-close">Close</button>
           </div>
           <p id="sb-status" class="sb-muted">
             Tap Fetch sales to calculate your bazaar revenue.
           </p>
           <div style="display:flex;gap:8px;flex-wrap:wrap">
             <button id="sb-run">Fetch sales</button>
             <button id="sb-export" disabled>Export CSV</button>
           </div>
           <div id="sb-results"></div>
         `;
         document.body.appendChild(panel);

         const $ = id => panel.querySelector("#" + id);

         $("sb-close").onclick = () => panel.remove();

         $("sb-run").onclick = async () => {
             if (busy) return;

             busy = true;
             $("sb-run").disabled = true;
             $("sb-export").disabled = true;
             $("sb-results").replaceChildren();
             $("sb-status").textContent = "Fetching bazaar sales...";

             try {
                 if (typeof PDA_httpGet !== "function") {
                     throw new Error(
                         "TornPDA API helper unavailable. Check injection."
                     );
                 }

                 if (!PDAKey || PDAKey.startsWith("#")) {
                     throw new Error(
                         "API key injection failed. Check TornPDA settings."
                     );
                 }

                 const end = Math.floor(Date.now() / 1000);
                 const start = end - 86400;
                 const entries = await fetchSales(start, end, $);

                 await renderReport(entries, start, end, $);
             } catch (error) {
                 console.error(PREFIX, error);
                 $("sb-status").textContent = "Error: " + error.message;
             } finally {
                 busy = false;
                 $("sb-run").disabled = false;
             }
         };

         $("sb-export").onclick = () => {
             if (!csvRows.length) return;

             const csv = csvRows.map(row => row.map(value =>
                 '"' + String(value ?? "").replace(/"/g, '""') + '"'
             ).join(",")).join("\r\n");

             const blob = new Blob(["\uFEFF" + csv], {
                 type: "text/csv;charset=utf-8"
             });
             const url = URL.createObjectURL(blob);
             const link = document.createElement("a");
             link.href = url;
             link.download = "torn-bazaar-sales-24h.csv";
             link.click();
             setTimeout(() => URL.revokeObjectURL(url), 1000);
         };
     }

     async function requestLogs(from, to) {
         const url = "https://api.torn.com/v2/user/log" +
             "?limit=" + PAGE_SIZE +
             "&from=" + encodeURIComponent(from) +
             "&to=" + encodeURIComponent(to) +
             "&key=" + encodeURIComponent(PDAKey);

         const response = await PDA_httpGet(url, {});
         if (!response) throw new Error("Empty API response.");

         const raw = response.responseText ??
                     response.response ??
                     response;

         const data = typeof raw === "string" ? JSON.parse(raw) : raw;

         if (data.error) {
             throw new Error(
                 "Torn API " + (data.error.code ?? "?") +
                 ": " + (data.error.error || "Request failed")
             );
         }

         if (!Array.isArray(data.log)) {
             throw new Error(
                 "Unexpected API response. Expected the v2 log array."
             );
         }

         return data.log;
     }

     async function fetchSales(start, end, $) {
         const collected = new Map();
         let cursor = end;
         let pages = 0;

         while (cursor >= start) {
             pages++;

             if (pages > 30) {
                 throw new Error(
                     "Safety limit reached. The report may be incomplete."
                 );
             }

             $("sb-status").textContent =
                 "Fetching log page " + pages + "...";

             const entries = await requestLogs(start, cursor);
             if (!entries.length) break;

             let oldest = Infinity;

             for (const entry of entries) {
                 const ts = Number(entry.timestamp || 0);
                 if (!ts) continue;

                 oldest = Math.min(oldest, ts);
                 if (ts < start || ts > end) continue;

                 const id = entry.id ?? entry.log_id ??
                     entry.nanostamp ??
                     (ts + ":" + JSON.stringify(entry));

                 collected.set(String(id), entry);
             }

             if (entries.length < PAGE_SIZE ||
                 oldest <= start || oldest === Infinity) break;

             if (oldest >= cursor) {
                 throw new Error(
                     "Pagination stalled; stopped to avoid duplicate data."
                 );
             }

             cursor = oldest - 1;
         }

         return [...collected.values()];
     }

     function logDetails(entry) {
         const details = entry.details || {};

         return {
             category: String(
                 details.category ?? entry.category ?? ""
             ),
             title: String(
                 details.title ?? entry.title ?? ""
             ),
             data: entry.data || {}
         };
     }

     function parseSale(entry) {
         const info = logDetails(entry);

         if (info.category.toLowerCase() !== "bazaars" ||
             info.title.toLowerCase() !== "bazaar sell") {
             return null;
         }

         const d = info.data;
         const buyerValue =
             d.buyer ?? d.buyer_id ?? d.user_id ?? null;

         let buyer = "";
         let buyerId = "";

         if (buyerValue && typeof buyerValue === "object") {
             buyer = String(
                 buyerValue.name ?? buyerValue.username ?? ""
             );
             buyerId = String(
                 buyerValue.id ?? buyerValue.user_id ?? ""
             );
         } else if (buyerValue != null) {
             const value = String(buyerValue);

             if (/^\d+$/.test(value)) {
                 buyerId = value;
             } else {
                 buyer = value;
             }
         }

         const items = Array.isArray(d.items)
             ? d.items.map(item => ({
                 id: item.id ?? item.item_id ?? "",
                 name: item.name ?? "",
                 qty: Number(
                     item.qty ?? item.quantity ?? item.amount ?? 0
                 )
             }))
             : [];

         const quantity = items.reduce(
             (sum, item) => sum + Math.max(0, item.qty), 0
         );

         let total = Number(d.cost_total ?? d.total_cost ?? 0);

         if (!(total > 0)) {
             const each = Number(d.cost_each ?? 0);

             if (each > 0 && quantity > 0) {
                 total = each * quantity;
             }
         }

         return {
             timestamp: Number(entry.timestamp || 0),
             buyer,
             buyerId,
             items,
             quantity,
             total,
             valid: Boolean((buyer || buyerId) && total > 0)
         };
     }

     async function resolveBuyerNames(sales, $) {
         const ids = [...new Set(
             sales
                 .filter(sale => sale.buyerId && !sale.buyer)
                 .map(sale => sale.buyerId)
         )];

         let lookedUp = 0;

         for (const id of ids) {
             if (buyerNameCache.has(id)) continue;

             try {
                 const url =
                     "https://api.torn.com/user/" +
                     encodeURIComponent(id) +
                     "?selections=basic&key=" +
                     encodeURIComponent(PDAKey);

                 const response = await PDA_httpGet(url, {});

                 const raw = response?.responseText ??
                             response?.response ??
                             response;

                 const data = typeof raw === "string"
                     ? JSON.parse(raw)
                     : raw;

                 if (data.error) {
                     buyerNameCache.set(id, null);
                 } else {
                     buyerNameCache.set(
                         id,
                         data.name || data.player_name || null
                     );
                 }
             } catch (error) {
                 console.warn(
                     PREFIX, "Username lookup failed for", id, error
                 );
                 buyerNameCache.set(id, null);
             }

             lookedUp++;

             if (lookedUp % 10 === 0) {
                 $("sb-status").textContent =
                     "Looking up buyer names (" +
                     lookedUp + "/" + ids.length + ")...";
             }
         }

         for (const sale of sales) {
             if (!sale.buyer && sale.buyerId) {
                 sale.buyer =
                     buyerNameCache.get(sale.buyerId) ||
                     "Player ID " + sale.buyerId;
             }
         }
     }

     function addProfileLink(cell, buyerId, buyerName) {
         if (buyerId && /^\d+$/.test(String(buyerId))) {
             const link = document.createElement("a");

             link.className = "sb-profile";
             link.href =
                 "https://www.torn.com/profiles.php?XID=" +
                 encodeURIComponent(buyerId);
             link.textContent = buyerName || ("Player ID " + buyerId);
             link.target = "_blank";
             link.rel = "noopener noreferrer";

             cell.appendChild(link);
         } else {
             cell.textContent = buyerName || "Unknown buyer";
         }
     }

     async function renderReport(entries, start, end, $) {
         const results = $("sb-results");
         results.replaceChildren();
         csvRows = [];

         const allSales = [];
         let ignored = 0;

         for (const entry of entries) {
             const sale = parseSale(entry);
             if (!sale) continue;

             if (!sale.valid) {
                 ignored++;
                 continue;
             }

             allSales.push(sale);
         }

         allSales.sort((a, b) => b.timestamp - a.timestamp);

         $("sb-status").textContent =
             "Found " + allSales.length +
             " possible sales. Resolving buyer names...";

         await resolveBuyerNames(allSales, $);

         const buyers = new Map();

         for (const sale of allSales) {
             const key = sale.buyerId
                 ? "id:" + sale.buyerId
                 : "name:" + sale.buyer.toLowerCase();

             if (!buyers.has(key)) {
                 buyers.set(key, {
                     name: sale.buyer || "Unknown buyer",
                     id: sale.buyerId,
                     total: 0,
                     transactions: 0,
                     items: 0
                 });
             }

             const buyer = buyers.get(key);
             buyer.total += sale.total;
             buyer.transactions++;
             buyer.items += sale.quantity;

             if (!buyer.name || buyer.name.startsWith("Player ID ")) {
                 buyer.name = sale.buyer || buyer.name;
             }
         }

         const leaderboard = [...buyers.values()].sort(
             (a, b) => b.total - a.total
         );

         const totalRevenue = allSales.reduce(
             (sum, sale) => sum + sale.total, 0
         );

         const totalItems = allSales.reduce(
             (sum, sale) => sum + sale.quantity, 0
         );

         const heading = document.createElement("h4");
         heading.textContent = "Last 24 hours";
         results.appendChild(heading);

         const summary = document.createElement("div");
         summary.className = "sb-total";

         const summaryLabel = document.createElement("div");
         summaryLabel.textContent = "Total recorded bazaar revenue";
         summary.appendChild(summaryLabel);

         const amount = document.createElement("div");
         amount.style.fontSize = "25px";
         amount.style.fontWeight = "bold";
         amount.textContent = money(totalRevenue);
         summary.appendChild(amount);

         const sub = document.createElement("div");
         sub.className = "sb-muted";
         sub.textContent =
             allSales.length + " sales · " + totalItems +
             " items · " + buyers.size + " buyers";
         summary.appendChild(sub);

         results.appendChild(summary);

         const buyerHeading = document.createElement("h4");
         buyerHeading.textContent = "Buyers ranked by total spent";
         results.appendChild(buyerHeading);

         if (!leaderboard.length) {
             const note = document.createElement("p");
             note.textContent =
                 "No confirmed Bazaar sell records were found. " +
                 "The log endpoint or event fields may differ from " +
                 "the format this script currently expects.";
             results.appendChild(note);
         } else {
             const table = document.createElement("table");

             table.innerHTML =
                 "<thead><tr>" +
                 "<th style='width:43%'>Buyer</th>" +
                 "<th style='width:27%'>Spent</th>" +
                 "<th style='width:15%'>Sales</th>" +
                 "<th style='width:15%'>Items</th>" +
                 "</tr></thead>";

             const tbody = document.createElement("tbody");

             for (const buyer of leaderboard) {
                 const tr = document.createElement("tr");
                 const nameCell = document.createElement("td");

                 addProfileLink(nameCell, buyer.id, buyer.name);
                 tr.appendChild(nameCell);

                 for (const value of [
                     money(buyer.total),
                     buyer.transactions,
                     buyer.items
                 ]) {
                     const td = document.createElement("td");
                     td.textContent = String(value);
                     tr.appendChild(td);
                 }

                 tbody.appendChild(tr);
             }

             table.appendChild(tbody);
             results.appendChild(table);
         }

         const detailHeading = document.createElement("h4");
         detailHeading.textContent = "Individual sales";
         results.appendChild(detailHeading);

         if (allSales.length) {
             const table = document.createElement("table");

             table.innerHTML =
                 "<thead><tr>" +
                 "<th style='width:28%'>Date</th>" +
                 "<th style='width:25%'>Buyer</th>" +
                 "<th style='width:27%'>Items</th>" +
                 "<th style='width:20%'>Total</th>" +
                 "</tr></thead>";

             const tbody = document.createElement("tbody");

             for (const sale of allSales) {
                 const tr = document.createElement("tr");

                 const dateCell = document.createElement("td");
                 dateCell.textContent = fmtDate(sale.timestamp);
                 tr.appendChild(dateCell);

                 const buyerCell = document.createElement("td");
                 addProfileLink(
                     buyerCell, sale.buyerId, sale.buyer
                 );
                 tr.appendChild(buyerCell);

                 const itemCell = document.createElement("td");
                 itemCell.textContent = sale.items.length
                     ? sale.items.map(item =>
                         (item.name || ("Item #" + item.id)) +
                         " × " + item.qty
                     ).join("; ")
                     : "Item details unavailable";
                 tr.appendChild(itemCell);

                 const totalCell = document.createElement("td");
                 totalCell.textContent = money(sale.total);
                 tr.appendChild(totalCell);

                 tbody.appendChild(tr);
             }

             table.appendChild(tbody);
             results.appendChild(table);
         }

         if (ignored) {
             const warning = document.createElement("p");
             warning.className = "sb-muted";
             warning.textContent = ignored +
                 " possible sale record(s) were excluded because the " +
                 "buyer or transaction total could not be verified.";
             results.appendChild(warning);
         }

         const coverage = document.createElement("p");
         coverage.className = "sb-muted";
         coverage.textContent =
             "Window: " + fmtDate(start) + " to " + fmtDate(end) +
             ". Retrieved " + entries.length + " log entries.";
         results.appendChild(coverage);

         csvRows = [
             [
                 "Timestamp", "Buyer", "Buyer ID",
                 "Items", "Quantity", "Total"
             ],
             ...allSales.map(sale => [
                 fmtDate(sale.timestamp),
                 sale.buyer,
                 sale.buyerId,
                 sale.items.map(item =>
                     (item.name || ("Item #" + item.id)) +
                     " x " + item.qty
                 ).join("; "),
                 sale.quantity,
                 sale.total
             ])
         ];

         $("sb-export").disabled = allSales.length === 0;

         $("sb-status").textContent =
             "Finished. " + allSales.length +
             " recorded sales across " + buyers.size + " buyers.";
     }

     function refreshButton() {
         const page = location.href;
         if (page === currentPage) return;

         currentPage = page;
         document.getElementById("sb-launch")?.remove();
         document.getElementById("sb-panel")?.remove();

         makeButton();
     }

     refreshButton();

     const observer = new MutationObserver(() => {
         if (!document.getElementById("sb-launch") &&
             !document.getElementById("sb-panel")) {
             makeButton();
         }
     });

     observer.observe(document.documentElement, {
         childList: true,
         subtree: true
     });

     setInterval(refreshButton, 1000);
 })();