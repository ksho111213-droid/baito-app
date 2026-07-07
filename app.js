"use strict";

// =============================================================
// バイト代 計算アプリ — データ管理・計算・画面描画
// データはブラウザの localStorage(端末内の保存領域)に保存する。
// サーバー不要でオフライン動作するが、別端末とは同期しない。
// =============================================================

const SETTINGS_KEY = "baito.settings";
const ENTRIES_KEY = "baito.entries";

// ---- データ読み書き ----
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && typeof s === "object") {
      return { defaultTransport: Number(s.defaultTransport) || 0, lastWage: Number(s.lastWage) || 0 };
    }
  } catch (e) { /* 壊れていたら初期値へ */ }
  return { defaultTransport: 0, lastWage: 0 };
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function loadEntries() {
  try {
    const arr = JSON.parse(localStorage.getItem(ENTRIES_KEY));
    if (Array.isArray(arr)) return arr;
  } catch (e) { /* ignore */ }
  return [];
}
function saveEntries(arr) {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(arr));
}

let settings = loadSettings();
let entries = loadEntries();

// ---- 計算ヘルパー ----
// 労働分の金額(交通費を除く)。円未満は四捨五入。
function laborPay(entry) {
  return Math.round(entry.wage * entry.minutes / 60);
}
// 1件の合計(労働 + 交通費)
function totalPay(entry) {
  return laborPay(entry) + (Number(entry.transport) || 0);
}
// "YYYY-MM-DD" → "YYYY-MM"
function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function yen(n) {
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}
// 分 → "◯時間◯分"(0分なら「◯時間」など読みやすく)
function minutesToText(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}時間${m}分`;
  if (h) return `${h}時間`;
  return `${m}分`;
}

// ---- 画面描画 ----
const app = document.getElementById("app");

function render() {
  const thisMonth = monthOf(todayStr());
  app.innerHTML = "";
  app.appendChild(renderSummary(thisMonth));
  app.appendChild(renderForm());
  app.appendChild(renderMonthEntries(thisMonth));
  app.appendChild(renderHistory(thisMonth));
  app.appendChild(renderSettings());
}

// 今月の合計カード
function renderSummary(thisMonth) {
  const monthEntries = entries.filter(e => monthOf(e.date) === thisMonth);
  let labor = 0, transport = 0, minutes = 0;
  const days = new Set();
  for (const e of monthEntries) {
    labor += laborPay(e);
    transport += Number(e.transport) || 0;
    minutes += e.minutes;
    days.add(e.date);
  }
  const total = labor + transport;

  const [y, m] = thisMonth.split("-");
  const card = el("section", "card");
  card.innerHTML = `
    <p class="summary-month">${Number(y)}年${Number(m)}月(月初め〜今日)</p>
    <div class="summary-amount">${yen(total)}</div>
    <div class="summary-breakdown">
      <span>働いた分 <b>${yen(labor)}</b></span>
      <span>交通費 <b>${yen(transport)}</b></span>
      <span>勤務 <b>${days.size}日</b></span>
      <span>合計 <b>${minutesToText(minutes)}</b></span>
    </div>`;
  return card;
}

// 記録を追加するフォーム
function renderForm() {
  const card = el("section", "card");
  card.innerHTML = `
    <h2>勤務を記録する</h2>
    <form id="entryForm">
      <div class="form-grid">
        <div class="field">
          <label for="f-date">日付</label>
          <input type="date" id="f-date" required>
        </div>
        <div class="field">
          <label>働いた時間</label>
          <div class="time-inputs">
            <input type="number" id="f-hours" min="0" step="1" placeholder="0" inputmode="numeric">
            <span>時間</span>
            <input type="number" id="f-mins" min="0" max="59" step="1" placeholder="0" inputmode="numeric">
            <span>分</span>
          </div>
        </div>
        <div class="field">
          <label for="f-wage">時給(円)</label>
          <input type="number" id="f-wage" min="0" step="1" inputmode="numeric" required>
        </div>
        <div class="field">
          <label for="f-transport">交通費(円)</label>
          <input type="number" id="f-transport" min="0" step="1" inputmode="numeric">
        </div>
      </div>
      <button type="submit" class="btn-primary">この勤務を追加</button>
    </form>`;

  const form = card.querySelector("#entryForm");
  form.querySelector("#f-date").value = todayStr();
  if (settings.lastWage) form.querySelector("#f-wage").value = settings.lastWage;
  form.querySelector("#f-transport").value = settings.defaultTransport || 0;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    addEntryFromForm(form);
  });
  return card;
}

function addEntryFromForm(form) {
  const date = form.querySelector("#f-date").value;
  const hours = parseInt(form.querySelector("#f-hours").value, 10) || 0;
  const mins = parseInt(form.querySelector("#f-mins").value, 10) || 0;
  const wage = parseInt(form.querySelector("#f-wage").value, 10) || 0;
  const transport = parseInt(form.querySelector("#f-transport").value, 10) || 0;
  const minutes = hours * 60 + mins;

  if (!date) { alert("日付を入力してください。"); return; }
  if (minutes <= 0) { alert("働いた時間を入力してください。"); return; }
  if (wage <= 0) { alert("時給を入力してください。"); return; }

  entries.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date, minutes, wage, transport,
  });
  saveEntries(entries);

  // 次回の初期表示用に、時給と交通費を覚えておく
  settings.lastWage = wage;
  settings.defaultTransport = transport;
  saveSettings(settings);

  render();
}

// 今月の記録一覧
function renderMonthEntries(thisMonth) {
  const card = el("section", "card");
  const h = el("h2");
  h.textContent = "今月の記録";
  card.appendChild(h);

  const list = entries
    .filter(e => monthOf(e.date) === thisMonth)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (list.length === 0) {
    const p = el("p", "empty");
    p.textContent = "まだ記録がありません。上のフォームから追加してください。";
    card.appendChild(p);
    return card;
  }
  for (const e of list) card.appendChild(renderEntryRow(e));
  return card;
}

function renderEntryRow(e) {
  const row = el("div", "entry");
  const info = el("div", "entry-info");
  const date = el("div", "date");
  date.textContent = formatDate(e.date);
  const detail = el("div", "detail");
  const transText = e.transport ? ` ・交通費${yen(e.transport)}` : "";
  detail.textContent = `${minutesToText(e.minutes)} ・時給${yen(e.wage)}${transText}`;
  info.appendChild(date);
  info.appendChild(detail);

  const right = el("div", "entry-right");
  const amount = el("span", "entry-amount");
  amount.textContent = yen(totalPay(e));
  const del = el("button", "del-btn");
  del.textContent = "×";
  del.title = "この記録を削除";
  del.addEventListener("click", () => deleteEntry(e.id));

  right.appendChild(amount);
  right.appendChild(del);
  row.appendChild(info);
  row.appendChild(right);
  return row;
}

function deleteEntry(id) {
  if (!confirm("この記録を削除しますか？")) return;
  entries = entries.filter(e => e.id !== id);
  saveEntries(entries);
  render();
}

// 過去の月(履歴)
function renderHistory(thisMonth) {
  const card = el("section", "card");
  const h = el("h2");
  h.textContent = "過去の月";
  card.appendChild(h);

  // 今月以外の月を新しい順に
  const months = [...new Set(entries.map(e => monthOf(e.date)))]
    .filter(m => m !== thisMonth)
    .sort((a, b) => (a < b ? 1 : -1));

  if (months.length === 0) {
    const p = el("p", "empty");
    p.textContent = "まだ過去の月の記録はありません。";
    card.appendChild(p);
    return card;
  }

  for (const m of months) {
    const monthEntries = entries
      .filter(e => monthOf(e.date) === m)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const total = monthEntries.reduce((s, e) => s + totalPay(e), 0);
    const days = new Set(monthEntries.map(e => e.date)).size;
    const [y, mm] = m.split("-");

    const det = el("details", "history-month");
    const sum = el("summary");
    sum.innerHTML = `<span class="m-label">${Number(y)}年${Number(mm)}月 <span style="color:var(--text-muted);font-size:0.8rem">(${days}日)</span></span><span class="m-total">${yen(total)}</span>`;
    det.appendChild(sum);

    const detail = el("div", "history-detail");
    for (const e of monthEntries) detail.appendChild(renderEntryRow(e));
    det.appendChild(detail);
    card.appendChild(det);
  }
  return card;
}

// 設定(交通費の既定額)
function renderSettings() {
  const card = el("section", "card");
  card.innerHTML = `
    <h2>設定</h2>
    <div class="setting-row">
      <div class="field">
        <label for="s-transport">交通費の既定額(円 / 1回)</label>
        <input type="number" id="s-transport" min="0" step="1" inputmode="numeric" value="${settings.defaultTransport || 0}">
      </div>
      <button id="s-save">保存</button>
    </div>
    <p class="saved-note" id="s-note"></p>`;

  card.querySelector("#s-save").addEventListener("click", () => {
    const v = parseInt(card.querySelector("#s-transport").value, 10) || 0;
    settings.defaultTransport = v;
    saveSettings(settings);
    const note = card.querySelector("#s-note");
    note.textContent = "保存しました(次に勤務を記録するときの初期値になります)";
    // フォームの交通費欄も更新するため再描画
    setTimeout(render, 900);
  });
  return card;
}

// ---- 小さなユーティリティ ----
function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${w})`;
}

// ---- 全消去ボタン ----
document.getElementById("resetBtn").addEventListener("click", () => {
  if (!confirm("すべての記録を削除します。よろしいですか？(元に戻せません)")) return;
  entries = [];
  saveEntries(entries);
  render();
});

// ---- 起動 ----
render();
