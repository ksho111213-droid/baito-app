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
      return {
        defaultTransport: Number(s.defaultTransport) || 0,
        lastWage: Number(s.lastWage) || 0,
        lastDailyWage: Number(s.lastDailyWage) || 0,
        lastPayType: s.lastPayType === "daily" ? "daily" : "hourly",
      };
    }
  } catch (e) { /* 壊れていたら初期値へ */ }
  return { defaultTransport: 0, lastWage: 0, lastDailyWage: 0, lastPayType: "hourly" };
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function loadEntries() {
  try {
    const arr = JSON.parse(localStorage.getItem(ENTRIES_KEY));
    // date形式が壊れた記録が混ざっていても、他の記録は読み込めるように除外する
    if (Array.isArray(arr)) {
      return arr
        .filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
        // 日給機能を追加する前の記録にはpayTypeが無いため、時給扱いにする
        .map(e => ({ payType: "hourly", dailyWage: 0, ...e }));
    }
  } catch (e) { /* ignore */ }
  return [];
}
function saveEntries(arr) {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(arr));
}

let settings = loadSettings();
let entries = loadEntries();

// 別タブ/別ウィンドウでの変更を取り込む(片方の記録が消えるのを防ぐ)
window.addEventListener("storage", (ev) => {
  if (ev.key === ENTRIES_KEY) entries = loadEntries();
  if (ev.key === SETTINGS_KEY) settings = loadSettings();
  if (ev.key === ENTRIES_KEY || ev.key === SETTINGS_KEY) render();
});

// ---- 計算ヘルパー ----
// 労働分の金額(交通費を除く)。円未満は四捨五入。
function laborPay(entry) {
  if (entry.payType === "daily") return Math.round(Number(entry.dailyWage) || 0);
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
// 日付の新しい順に並び替える(同じ日付は元の順序を保つ)
function sortByDateDesc(list) {
  return list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
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

const FORM_FIELD_IDS = ["f-date", "f-hours", "f-mins", "f-wage", "f-daily-wage", "f-transport"];

// 削除など他の操作で再描画が起きても、入力中の勤務記録フォームの内容を保つ
function captureFormState() {
  const form = document.getElementById("entryForm");
  if (!form) return null;
  const state = {};
  for (const id of FORM_FIELD_IDS) state[id] = form.querySelector("#" + id)?.value ?? "";
  state.payType = form.querySelector('input[name="payType"]:checked')?.value ?? "";
  return state;
}
function restoreFormState(state) {
  if (!state) return;
  const form = document.getElementById("entryForm");
  if (!form) return;
  for (const id of FORM_FIELD_IDS) {
    const input = form.querySelector("#" + id);
    if (input && state[id]) input.value = state[id];
  }
  // 選択中だった給与の種類(時給/日給)も復元し、表示切り替えを再適用する
  if (state.payType) {
    const radio = form.querySelector(`input[name="payType"][value="${state.payType}"]`);
    if (radio) {
      radio.checked = true;
      applyPayTypeToForm(form);
    }
  }
}

function render() {
  const formState = captureFormState();
  const thisMonth = monthOf(todayStr());
  app.innerHTML = "";
  app.appendChild(renderSummary(thisMonth));
  app.appendChild(renderForm());
  app.appendChild(renderMonthEntries(thisMonth));
  app.appendChild(renderHistory(thisMonth));
  app.appendChild(renderSettings());
  restoreFormState(formState);
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
        <div class="field full">
          <label>給与の種類</label>
          <div class="pay-type-toggle">
            <label><input type="radio" name="payType" value="hourly"> 時給</label>
            <label><input type="radio" name="payType" value="daily"> 日給</label>
          </div>
        </div>
        <div class="field">
          <label for="f-date">日付</label>
          <input type="date" id="f-date" required>
        </div>
        <div class="field">
          <label id="f-hours-label">働いた時間</label>
          <div class="time-inputs">
            <input type="number" id="f-hours" min="0" step="1" placeholder="0" inputmode="numeric">
            <span>時間</span>
            <input type="number" id="f-mins" min="0" max="59" step="1" placeholder="0" inputmode="numeric">
            <span>分</span>
          </div>
        </div>
        <div class="field" id="wage-field">
          <label for="f-wage">時給(円)</label>
          <input type="number" id="f-wage" min="0" step="1" inputmode="numeric">
        </div>
        <div class="field" id="daily-wage-field">
          <label for="f-daily-wage">日給(円)</label>
          <input type="number" id="f-daily-wage" min="0" step="1" inputmode="numeric">
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
  if (settings.lastDailyWage) form.querySelector("#f-daily-wage").value = settings.lastDailyWage;
  form.querySelector("#f-transport").value = settings.defaultTransport || 0;

  const payTypeRadios = form.querySelectorAll('input[name="payType"]');
  for (const radio of payTypeRadios) {
    radio.checked = radio.value === settings.lastPayType;
    radio.addEventListener("change", () => applyPayTypeToForm(form));
  }
  applyPayTypeToForm(form);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    addEntryFromForm(form);
  });
  return card;
}

// 選ばれた給与の種類(時給/日給)に合わせて、入力欄の表示・必須項目を切り替える
function applyPayTypeToForm(form) {
  const payType = form.querySelector('input[name="payType"]:checked')?.value || "hourly";
  const isDaily = payType === "daily";
  form.querySelector("#wage-field").style.display = isDaily ? "none" : "";
  form.querySelector("#daily-wage-field").style.display = isDaily ? "" : "none";
  form.querySelector("#f-wage").required = !isDaily;
  form.querySelector("#f-daily-wage").required = isDaily;
  form.querySelector("#f-hours-label").textContent = isDaily ? "働いた時間(任意)" : "働いた時間";
}

function addEntryFromForm(form) {
  const payType = form.querySelector('input[name="payType"]:checked')?.value || "hourly";
  const date = form.querySelector("#f-date").value;
  const hours = parseInt(form.querySelector("#f-hours").value, 10) || 0;
  const mins = parseInt(form.querySelector("#f-mins").value, 10) || 0;
  const wage = parseInt(form.querySelector("#f-wage").value, 10) || 0;
  const dailyWage = parseInt(form.querySelector("#f-daily-wage").value, 10) || 0;
  const transport = parseInt(form.querySelector("#f-transport").value, 10) || 0;
  const minutes = hours * 60 + mins;

  if (!date) { alert("日付を入力してください。"); return; }
  if (payType === "hourly") {
    // 時給: 金額×時間で計算するので、時間と時給が必須
    if (minutes <= 0) { alert("働いた時間を入力してください。"); return; }
    if (wage <= 0) { alert("時給を入力してください。"); return; }
  } else {
    // 日給: 固定額なので日給の金額だけ必須(時間は任意)
    if (dailyWage <= 0) { alert("日給を入力してください。"); return; }
    if (minutes < 0) { alert("働いた時間が正しくありません。"); return; }
  }
  if (transport < 0) { alert("交通費は0円以上を入力してください。"); return; }

  entries.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date, minutes, wage, dailyWage, payType, transport,
  });
  saveEntries(entries);

  // 次回の初期表示用に、選んだ種類と金額・交通費を覚えておく
  settings.lastPayType = payType;
  if (payType === "hourly") settings.lastWage = wage;
  else settings.lastDailyWage = dailyWage;
  settings.defaultTransport = transport;
  saveSettings(settings);

  // 次の入力のため、時間欄だけ空にしておく(render()が現在の入力値を復元するため)
  form.querySelector("#f-hours").value = "";
  form.querySelector("#f-mins").value = "";

  render();
}

// 今月の記録一覧
function renderMonthEntries(thisMonth) {
  const card = el("section", "card");
  const h = el("h2");
  h.textContent = "今月の記録";
  card.appendChild(h);

  const list = sortByDateDesc(entries.filter(e => monthOf(e.date) === thisMonth));

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
  if (e.payType === "daily") {
    // 日給: 時間は任意入力なので、入力があるときだけ表示する
    const timeText = e.minutes > 0 ? `${minutesToText(e.minutes)} ・` : "";
    detail.textContent = `${timeText}日給${yen(e.dailyWage)}${transText}`;
  } else {
    detail.textContent = `${minutesToText(e.minutes)} ・時給${yen(e.wage)}${transText}`;
  }
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
    const monthEntries = sortByDateDesc(entries.filter(e => monthOf(e.date) === m));
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
    if (v < 0) { alert("交通費は0円以上を入力してください。"); return; }
    settings.defaultTransport = v;
    saveSettings(settings);
    const note = card.querySelector("#s-note");
    note.textContent = "保存しました(次に勤務を記録するときの初期値になります)";
    // 表示中の勤務記録フォームがあれば、その場で新しい既定値を反映する
    // (画面全体を再描画すると、入力中の内容が消えてしまうため)
    const transportInput = document.getElementById("f-transport");
    if (transportInput) transportInput.value = v;
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
