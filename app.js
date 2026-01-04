const LS_KEY = "slstrades_journal_v3";
const START_BALANCE = 4475;

const COMM_PER_CONTRACT_PER_SIDE = 0.67; // buy + sell per contract
const BE_DAY_MIN = -10;
const BE_DAY_MAX = 10;

const form = document.getElementById("tradeForm");
const notes = document.getElementById("notes");
const charCount = document.getElementById("charCount");
const shotsInput = document.getElementById("shots");
const dropzone = document.getElementById("dropzone");

const tradesTbody = document.getElementById("tradesTbody");

const filterTicker = document.getElementById("filterTicker");
const filterOutcome = document.getElementById("filterOutcome");
const sortBy = document.getElementById("sortBy");

const winRateBig = document.getElementById("winRateBig");
const winRateSmall = document.getElementById("winRateSmall");
const ringProgress = document.getElementById("ringProgress");
const netPnlBig = document.getElementById("netPnlBig");
const tradesBig = document.getElementById("tradesBig");

const exportBtn = document.getElementById("exportBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

const avgWinnerEl = document.getElementById("avgWinner");
const avgLoserEl = document.getElementById("avgLoser");
const bestTickersEl = document.getElementById("bestTickers");
const worstTickersEl = document.getElementById("worstTickers");
const strategyPnLEl = document.getElementById("strategyPnL");

const calGrid = document.getElementById("calGrid");
const calTitle = document.getElementById("calTitle");
const calPrev = document.getElementById("calPrev");
const calNext = document.getElementById("calNext");

const commissionsPreview = document.getElementById("commissionsPreview");
const contractsInput = document.getElementById("contracts");

const imgModal = document.getElementById("imgModal");
const modalImg = document.getElementById("modalImg");
const modalClose = document.getElementById("modalClose");
const modalBackdrop = document.getElementById("modalBackdrop");

// Ring math
const RING_CIRCUMFERENCE = 289;

let pnlChart, wlChart;

// Calendar month shown
let calYear, calMonth; // month: 0-11

function money(n) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toFixed(2)}`;
}
function parseNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function normalizeTicker(t) {
  return (t || "").trim().toUpperCase();
}
function safeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* ---------- Time dropdowns (fix) ---------- */
function pad2(n) { return String(n).padStart(2, "0"); }

function to12HourLabel(h24, m) {
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad2(m)} ${ampm}`;
}

function generateMinuteOptions(selectEl, startH, startM, endH, endM) {
  selectEl.innerHTML = "";

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "--:--";
  selectEl.appendChild(blank);

  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  for (let t = startTotal; t <= endTotal; t++) {
    const h = Math.floor(t / 60);
    const m = t % 60;

    const opt = document.createElement("option");
    opt.value = `${pad2(h)}:${pad2(m)}`;          // store 24h
    opt.textContent = to12HourLabel(h, m);        // show 12h
    selectEl.appendChild(opt);
  }
}

function timeRangeLabel(entry24, exit24) {
  // show 12h range in table
  if (!entry24 && !exit24) return "--:-- → --:--";

  const fmt = (t24) => {
    if (!t24) return "--:--";
    const [h, m] = t24.split(":").map(Number);
    return to12HourLabel(h, m);
  };
  return `${fmt(entry24)} → ${fmt(exit24)}`;
}

/* ---------- Storage ---------- */
function loadTrades() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? []; }
  catch { return []; }
}
function saveTrades(trades) {
  localStorage.setItem(LS_KEY, JSON.stringify(trades));
}

/* ---------- Math ---------- */
function calcCommissions(contracts) {
  return (COMM_PER_CONTRACT_PER_SIDE * 2) * contracts;
}
function calcPnl(trade) {
  const entry = parseNum(trade.entry);
  const exit = parseNum(trade.exit);
  const qty = parseNum(trade.contracts, 1);
  const otherFees = parseNum(trade.otherFees, 0);
  const commissions = calcCommissions(qty);

  return (exit - entry) * 100 * qty - commissions - otherFees;
}
function outcomeFromPnl(pnl) {
  if (pnl > 0) return "WIN";
  if (pnl < 0) return "LOSS";
  return "BE";
}

/* ---------- Images ---------- */
async function fileToDataUrlCompressed(file, maxW = 1400, quality = 0.74) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/jpeg", quality);
}

async function readShotsFromFileList(fileList) {
  const files = Array.from(fileList || []).filter(f => f.type.startsWith("image/")).slice(0, 2);
  const out = [];
  for (const f of files) out.push(await fileToDataUrlCompressed(f));
  return out;
}

/* ---------- UI helpers ---------- */
function setRing(winRatePct) {
  const pct = Math.max(0, Math.min(100, winRatePct));
  const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
  ringProgress.style.strokeDashoffset = String(offset);

  if (pct >= 60) ringProgress.style.stroke = "var(--good)";
  else if (pct >= 45) ringProgress.style.stroke = "var(--warn)";
  else ringProgress.style.stroke = "var(--bad)";
}

function computeStats(trades) {
  let wins = 0, losses = 0, be = 0, net = 0;
  let sumWin = 0, sumLoss = 0;

  for (const t of trades) {
    net += t.pnl;
    if (t.outcome === "WIN") { wins++; sumWin += t.pnl; }
    else if (t.outcome === "LOSS") { losses++; sumLoss += t.pnl; }
    else be++;
  }

  const denom = wins + losses;
  const winRate = denom ? (wins / denom) * 100 : 0;

  const avgWinner = wins ? (sumWin / wins) : 0;
  const avgLoser = losses ? (sumLoss / losses) : 0;

  return { wins, losses, be, net, winRate, count: trades.length, avgWinner, avgLoser };
}

function updateStatsUI(stats) {
  winRateBig.textContent = `${Math.round(stats.winRate)}%`;
  winRateSmall.textContent = `${stats.wins}W • ${stats.losses}L • ${stats.be}B`;
  setRing(stats.winRate);

  netPnlBig.textContent = money(stats.net);
  netPnlBig.style.color =
    stats.net > 0 ? "var(--good)" : stats.net < 0 ? "var(--bad)" : "var(--text)";

  tradesBig.textContent = String(stats.count);

  avgWinnerEl.textContent = money(stats.avgWinner);
  avgWinnerEl.style.color = stats.avgWinner > 0 ? "var(--good)" : "var(--text)";
  avgLoserEl.textContent = money(stats.avgLoser);
  avgLoserEl.style.color = stats.avgLoser < 0 ? "var(--bad)" : "var(--text)";
}

function applyFiltersAndSort(trades) {
  const tkr = normalizeTicker(filterTicker.value);

  const out = trades.filter(tr => {
    const okTicker = !tkr || normalizeTicker(tr.ticker).includes(tkr);
    const okOutcome = filterOutcome.value === "ALL" || tr.outcome === filterOutcome.value;
    return okTicker && okOutcome;
  });

  const s = sortBy.value;
  out.sort((a, b) => {
    if (s === "NEWEST") return b.date.localeCompare(a.date);
    if (s === "OLDEST") return a.date.localeCompare(b.date);
    if (s === "BIGWIN") return (b.pnl - a.pnl);
    if (s === "BIGLOSS") return (a.pnl - b.pnl);
    return 0;
  });

  return out;
}

function renderTradesTable(trades) {
  tradesTbody.innerHTML = "";

  if (!trades.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7" style="color:var(--muted); padding:16px;">No trades yet. Add one above.</td>`;
    tradesTbody.appendChild(tr);
    return;
  }

  for (const trd of trades) {
    const tr = document.createElement("tr");
    const contract = `${normalizeTicker(trd.ticker)} ${trd.cp} DTE${trd.dte} ${trd.strike}`;
    const pnlClass = trd.outcome === "WIN" ? "good" : trd.outcome === "LOSS" ? "bad" : "be";
    const timeText = timeRangeLabel(trd.entryTime, trd.exitTime);

    tr.innerHTML = `
      <td>${trd.date}</td>
      <td>${timeText}</td>
      <td><span class="badge">${contract}</span></td>
      <td>${safeHtml(trd.strategy || "")}</td>
      <td>${trd.contracts}</td>
      <td class="pnl ${pnlClass}">${money(trd.pnl)}</td>
      <td style="text-align:right;">
        <button class="iconBtn" data-action="toggle" data-id="${trd.id}">Details</button>
        <button class="iconBtn" data-action="delete" data-id="${trd.id}">Delete</button>
      </td>
    `;
    tradesTbody.appendChild(tr);

    const detailsTr = document.createElement("tr");
    detailsTr.className = "detailsRow";
    detailsTr.dataset.detailsFor = trd.id;
    detailsTr.style.display = "none";

    const shotsHtml = (trd.shots || [])
      .map(s => `<img class="shot" src="${s}" alt="screenshot" data-shot="${s}" />`)
      .join("");

    const commissions = calcCommissions(parseNum(trd.contracts, 1));
    const otherFees = parseNum(trd.otherFees, 0);

    detailsTr.innerHTML = `
      <td colspan="7">
        <div class="details">
          <div>
            <strong>Prices:</strong><br/>
            Entry ${parseNum(trd.entry).toFixed(2)} → Exit ${parseNum(trd.exit).toFixed(2)}<br/>
            <strong>Costs:</strong><br/>
            Commissions: ${money(commissions)} • Other fees: ${money(otherFees)}<br/>
            <strong>Notes:</strong><br/>
            ${safeHtml(trd.notes) || "<em>No notes</em>"}
          </div>
          <div class="shots">${shotsHtml || ""}</div>
        </div>
      </td>
    `;
    tradesTbody.appendChild(detailsTr);
  }
}

/* ---------- Charts ---------- */
function initCharts() {
  const pnlCtx = document.getElementById("pnlChart").getContext("2d");
  const wlCtx = document.getElementById("wlChart").getContext("2d");

  pnlChart = new Chart(pnlCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Balance ($)",
          data: [],
          tension: 0.25
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // ✅ CSS controls chart height
      layout: { padding: 6 },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#9fb0d1" },
          grid: { color: "rgba(255,255,255,0.06)" }
        },
        y: {
          ticks: { color: "#9fb0d1" },
          grid: { color: "rgba(255,255,255,0.06)" }
        }
      }
    }
  });

  wlChart = new Chart(wlCtx, {
    type: "doughnut",
    data: {
      labels: ["Wins", "Losses", "Breakeven"],
      datasets: [
        {
          data: [0, 0, 0],
          backgroundColor: [
            "rgba(45,212,191,0.75)",  // wins
            "rgba(251,113,133,0.75)", // losses
            "rgba(148,163,184,0.65)"  // BE
          ],
          borderColor: [
            "rgba(45,212,191,1)",
            "rgba(251,113,133,1)",
            "rgba(148,163,184,1)"
          ],
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // ✅ CSS controls chart height
      cutout: "50%",
      radius: "80%",
      plugins: {
        legend: {
          position: "top",
          labels: {
            color: "#9fb0d1",
            boxWidth: 14,
            padding: 12
          }
        }
      }
    }
  });
}

function buildEquitySeries(trades) {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const labels = ["Start"];
  const values = [START_BALANCE];

  let bal = START_BALANCE;
  for (const t of sorted) {
    bal += t.pnl;
    labels.push(t.date);
    values.push(Number(bal.toFixed(2)));
  }
  return { labels, values };
}

function updateCharts(trades) {
  const { labels, values } = buildEquitySeries(trades);
  pnlChart.data.labels = labels;
  pnlChart.data.datasets[0].data = values;
  pnlChart.update();

  const stats = computeStats(trades);
  wlChart.data.datasets[0].data = [stats.wins, stats.losses, stats.be];
  wlChart.update();
}

/* ---------- Analysis ---------- */
function renderMiniList(container, items) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<div class="miniItem"><span class="muted">No data yet</span><span></span></div>`;
    return;
  }
  for (const it of items) {
    const valClass = it.value > 0 ? "pnl good" : it.value < 0 ? "pnl bad" : "pnl be";
    const div = document.createElement("div");
    div.className = "miniItem";
    div.innerHTML = `
      <span>${safeHtml(it.label)}</span>
      <span class="${valClass}">${money(it.value)}</span>
    `;
    container.appendChild(div);
  }
}

function updateAnalysis(trades) {
  const byTicker = new Map();
  const byStrat = new Map();

  for (const t of trades) {
    const tk = normalizeTicker(t.ticker);
    byTicker.set(tk, (byTicker.get(tk) || 0) + t.pnl);

    const st = (t.strategy || "Unknown");
    byStrat.set(st, (byStrat.get(st) || 0) + t.pnl);
  }

  const tickerArr = [...byTicker.entries()].map(([label, value]) => ({ label, value }));
  tickerArr.sort((a, b) => b.value - a.value);

  const best5 = tickerArr.slice(0, 5);
  const worst10 = [...tickerArr].sort((a,b) => a.value - b.value).slice(0, 10);

  const stratArr = [...byStrat.entries()].map(([label, value]) => ({ label, value }));
  stratArr.sort((a, b) => b.value - a.value);

  renderMiniList(bestTickersEl, best5);
  renderMiniList(worstTickersEl, worst10);
  renderMiniList(strategyPnLEl, stratArr);
}

/* ---------- Daily P&L Calendar ---------- */
function dateToYmd(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function startOfWeekSunday(dt) {
  const d = new Date(dt);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function aggregateDailyPnL(trades) {
  const map = new Map();
  for (const t of trades) {
    map.set(t.date, (map.get(t.date) || 0) + t.pnl);
  }
  return map;
}
function pnlClassForDay(pnl) {
  if (pnl > BE_DAY_MAX) return "good";
  if (pnl < BE_DAY_MIN) return "bad";
  return "be";
}
function renderCalendar(trades) {
  const daily = aggregateDailyPnL(trades);

  const monthStart = new Date(calYear, calMonth, 1);
  const monthEnd = new Date(calYear, calMonth + 1, 0);
  const gridStart = startOfWeekSunday(monthStart);

  calTitle.textContent = monthStart.toLocaleString(undefined, { month: "long", year: "numeric" });

  calGrid.innerHTML = "";
  const dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat","Week"];
  for (const d of dows) {
    const div = document.createElement("div");
    div.className = "calDow";
    div.textContent = d;
    calGrid.appendChild(div);
  }

  let cursor = new Date(gridStart);

  for (let week = 0; week < 6; week++) {
    let weekTotal = 0;

    for (let day = 0; day < 7; day++) {
      const ymd = dateToYmd(cursor);
      const inMonth = cursor.getMonth() === calMonth;
      const pnl = daily.get(ymd) || 0;
      weekTotal += pnl;

      const cell = document.createElement("div");
      const cls = pnlClassForDay(pnl);
      cell.className = `calCell ${cls} ${inMonth ? "" : "mutedDay"}`;
      cell.innerHTML = `
        <div class="calDate">
          <span>${cursor.getDate()}</span>
          <span class="muted"></span>
        </div>
        <div class="calPnl">${pnl !== 0 ? money(pnl) : "<span class='muted'>$0.00</span>"}</div>
      `;
      calGrid.appendChild(cell);

      cursor.setDate(cursor.getDate() + 1);
    }

    const wCell = document.createElement("div");
    const wCls = pnlClassForDay(weekTotal);
    wCell.className = `weekTotal ${wCls}`;
    wCell.innerHTML = `
      <div class="calDate"><span>Week</span><span class="muted">total</span></div>
      <div class="calPnl">${money(weekTotal)}</div>
    `;
    calGrid.appendChild(wCell);

    // (keep 6 rows stable)
    if (cursor > monthEnd && cursor.getDay() === 0) { /* noop */ }
  }
}

/* ---------- Modal ---------- */
function openModal(src) {
  modalImg.src = src;
  imgModal.setAttribute("aria-hidden", "false");
}
function closeModal() {
  imgModal.setAttribute("aria-hidden", "true");
  modalImg.src = "";
}

/* ---------- Rerender ---------- */
function rerender() {
  const all = loadTrades();
  const filtered = applyFiltersAndSort(all);

  renderTradesTable(filtered);

  const stats = computeStats(all);
  updateStatsUI(stats);

  updateCharts(all);
  updateAnalysis(all);
  renderCalendar(all);
}

/* ---------- Date Picker ---------- */
function setupDatePicker() {
  const dateInput = document.getElementById("date");
  flatpickr(dateInput, {
    dateFormat: "Y-m-d",
    defaultDate: new Date(),
    allowInput: true
  });
}

/* ---------- Commission preview ---------- */
function updateCommissionPreview() {
  const qty = parseNum(contractsInput.value, 1);
  const c = calcCommissions(qty);
  commissionsPreview.value = `${money(c)} (auto)`;
}

/* ---------- Events ---------- */
notes.addEventListener("input", () => {
  charCount.textContent = `${notes.value.length}/500`;
});

contractsInput.addEventListener("input", updateCommissionPreview);

/* Drag & Drop */
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragOver");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragOver"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragOver");
  dropzone._droppedFiles = e.dataTransfer.files;
});
shotsInput.addEventListener("change", () => {
  dropzone._droppedFiles = null;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const qty = parseNum(document.getElementById("contracts").value, 1);

  const fileSource = dropzone._droppedFiles ? dropzone._droppedFiles : shotsInput.files;
  const shots = await readShotsFromFileList(fileSource);

  const trade = {
    id: (crypto?.randomUUID?.() || String(Date.now()) + "-" + Math.random().toString(16).slice(2)),
    date: document.getElementById("date").value,

    entryTime: document.getElementById("entryTime").value, // "HH:MM"
    exitTime: document.getElementById("exitTime").value,

    ticker: normalizeTicker(document.getElementById("ticker").value),
    strategy: document.getElementById("strategy").value,

    cp: document.getElementById("cp").value,
    dte: parseNum(document.getElementById("dte").value, 0),
    strike: parseNum(document.getElementById("strike").value),

    entry: parseNum(document.getElementById("entry").value),
    exit: parseNum(document.getElementById("exit").value),

    contracts: qty,
    otherFees: parseNum(document.getElementById("otherFees").value, 0),

    notes: (document.getElementById("notes").value || "").trim(),
    shots
  };

  trade.pnl = Number(calcPnl(trade).toFixed(2));
  trade.outcome = outcomeFromPnl(trade.pnl);

  const trades = loadTrades();
  trades.push(trade);
  saveTrades(trades);

  form.reset();
  charCount.textContent = "0/500";
  dropzone._droppedFiles = null;

  // Keep date nice + commission preview
  document.getElementById("date").value = dateToYmd(new Date());
  updateCommissionPreview();

  // Keep dropdowns populated after reset
  setupTimeDropdowns();

  rerender();
});

tradesTbody.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  const img = e.target.closest("img.shot");

  if (img && img.dataset.shot) {
    openModal(img.dataset.shot);
    return;
  }

  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!action || !id) return;

  if (action === "toggle") {
    const detailsRow = document.querySelector(`tr[data-details-for="${id}"]`);
    if (detailsRow) {
      detailsRow.style.display = detailsRow.style.display === "none" ? "table-row" : "none";
    }
    return;
  }

  if (action === "delete") {
    const trades = loadTrades().filter(t => t.id !== id);
    saveTrades(trades);
    rerender();
  }
});

[filterTicker, filterOutcome, sortBy].forEach(el => {
  el.addEventListener("input", rerender);
  el.addEventListener("change", rerender);
});

exportBtn.addEventListener("click", () => {
  const trades = loadTrades();
  const blob = new Blob([JSON.stringify(trades, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "trading-journal-export.json";
  a.click();
  URL.revokeObjectURL(url);
});

clearAllBtn.addEventListener("click", () => {
  if (!confirm("Clear all trades? This cannot be undone.")) return;
  localStorage.removeItem(LS_KEY);
  rerender();
});

/* Calendar navigation */
function initCalendarState() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}
calPrev.addEventListener("click", () => {
  calMonth -= 1;
  if (calMonth < 0) { calMonth = 11; calYear -= 1; }
  rerender();
});
calNext.addEventListener("click", () => {
  calMonth += 1;
  if (calMonth > 11) { calMonth = 0; calYear += 1; }
  rerender();
});

/* Modal events */
modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

/* ---------- FIX: time dropdown init ---------- */
function setupTimeDropdowns() {
  const entryTimeEl = document.getElementById("entryTime");
  const exitTimeEl = document.getElementById("exitTime");

  // every minute 6:30 AM -> 8:00 AM
  generateMinuteOptions(entryTimeEl, 6, 30, 8, 0);
  generateMinuteOptions(exitTimeEl, 6, 30, 8, 0);
}

/* ---------- Init ---------- */
function init() {
  setupDatePicker();
  setupTimeDropdowns();      // ✅ this is the missing piece on your screen
  initCharts();
  initCalendarState();

  document.getElementById("date").value = dateToYmd(new Date());
  updateCommissionPreview();

  rerender();
}
init();

