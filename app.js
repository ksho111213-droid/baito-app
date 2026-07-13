"use strict";

// =============================================================
// バイト代 計算アプリ — データ管理・計算・画面描画
// データはブラウザの localStorage(端末内の保存領域)に保存する。
// サーバー不要でオフライン動作するが、別端末とは同期しない。
//
// ▼ このファイルの構成(上から順に)
//   1. データ読み書き   … localStorage への保存・読込
//   2. 計算ヘルパー      … 金額・時間・日付の計算や整形
//   3. ホイール選択      … Googleマップ風の回転ホイール(buildWheel)
//   4. 画面描画          … render() を起点に各カードを組み立てる
//   5. フォーム処理      … 入力の読み取り・検証・追加/編集
//
// ▼ 記録1件(entry)の形 ※ localStorage の "baito.entries"(配列)に入る
//   id:          文字列。記録を識別する一意なID(編集・削除で使う)
//   date:        "YYYY-MM-DD"。勤務日
//   payType:     "hourly"(時給) | "daily"(日給)
//   inputMode:   "time"(時刻で入力) | "duration"(時間で入力)
//   startTime:   "HH:MM"。時刻モードの開始(時間モードでは "")
//   endTime:     "HH:MM"。時刻モードの終了(時間モードでは "")
//   breakMinutes:数値。休憩(分)。時刻モードのみ。勤務時間から差し引く
//   minutes:     数値。休憩を引いた実働(分)。時給の金額計算に使う
//   wage:        数値。時給(円)
//   dailyWage:   数値。日給(円)
//   transport:   数値。交通費(円)
//   ※ 昔の記録に無い項目は loadEntries() で既定値を補う(互換処理)
//
// ▼ 設定(settings) ※ localStorage の "baito.settings"
//   defaultTransport / defaultBreak … フォームの初期値
//   lastPayType / lastInputMode / lastWage / lastDailyWage … 前回値の記憶
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
        defaultBreak: Number(s.defaultBreak) || 0,
        lastWage: Number(s.lastWage) || 0,
        lastDailyWage: Number(s.lastDailyWage) || 0,
        lastPayType: s.lastPayType === "daily" ? "daily" : "hourly",
        lastInputMode: s.lastInputMode === "duration" ? "duration" : "time",
      };
    }
  } catch (e) { /* 壊れていたら初期値へ */ }
  return {
    defaultTransport: 0, defaultBreak: 0, lastWage: 0, lastDailyWage: 0,
    lastPayType: "hourly", lastInputMode: "time",
  };
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
        // 昔の記録には無い項目があるため既定値で補う。
        // (payType=時給扱い / 入力方法=時間で入力 / 時刻・休憩は無し)
        .map(e => ({
          payType: "hourly", dailyWage: 0,
          inputMode: "duration", startTime: "", endTime: "", breakMinutes: 0,
          ...e,
        }));
    }
  } catch (e) { /* ignore */ }
  return [];
}
function saveEntries(arr) {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(arr));
}

let settings = loadSettings();
let entries = loadEntries();
// 編集中の記録ID(null なら新規追加モード)
let editingId = null;

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
// "HH:MM" → 0時からの分数
function timeToMin(t) {
  const [h, m] = String(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
// 分数 → "HH:MM"(値として保存する用。ゼロ埋め)
function minToTime(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
// "09:00" → "9:00"(表示用。先頭の0を外す)
function fmtTime(t) {
  const [h, m] = String(t).split(":");
  return `${Number(h)}:${m}`;
}

// ---- ホイール選択の候補({value, label} の配列) ----
// 開始〜終了(15分刻み)。先頭に未選択(空)の「—」を置き、新規は未選択から始める。
function timeWheelOptions() {
  const opts = [{ value: "", label: "—" }];
  for (let m = 0; m < 24 * 60; m += 15) {
    opts.push({ value: minToTime(m), label: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` });
  }
  return opts;
}
// 休憩(0〜4時間・15分刻み)
function breakWheelOptions() {
  const opts = [];
  for (let m = 0; m <= 240; m += 15) opts.push({ value: m, label: m === 0 ? "なし" : minutesToText(m) });
  return opts;
}
function hoursWheelOptions() {
  const opts = [];
  for (let h = 0; h <= 23; h++) opts.push({ value: h, label: String(h) });
  return opts;
}
function minsWheelOptions() {
  return [0, 15, 30, 45].map(m => ({ value: m, label: String(m) }));
}
// 設定画面の休憩(通常のプルダウン)用の <option>
function breakOptionsHTML(selected) {
  return breakWheelOptions()
    .map(o => `<option value="${o.value}"${o.value === selected ? " selected" : ""}>${o.label}</option>`)
    .join("");
}

// Googleマップ風の回転ホイールを作る。
//   container: 表示先の要素 / hidden: 値を保持する input / options: {value,label}[] / initial: 初期値
// スクロールで回り、中央の帯にある値が選択値になる。値は hidden に入れ、input イベントを発火する。
const WHEEL_ITEM_H = 34; // 1項目の高さ(px)。CSSと合わせる
function buildWheel(container, hidden, options, initial) {
  container.classList.add("wheel");
  const scroll = document.createElement("div");
  scroll.className = "wheel-scroll";
  options.forEach((o, i) => {
    const it = document.createElement("div");
    it.className = "wheel-item";
    it.textContent = o.label;
    it.dataset.index = i;
    it.addEventListener("click", () => scrollToIndex(i, true));
    scroll.appendChild(it);
  });
  const hl = document.createElement("div");
  hl.className = "wheel-highlight";
  container.appendChild(scroll);
  container.appendChild(hl);

  let idx = options.findIndex(o => String(o.value) === String(initial));
  if (idx < 0) idx = 0;

  function markCenter(i) {
    for (const el of scroll.children) el.classList.toggle("is-center", Number(el.dataset.index) === i);
  }
  function clampIndex(i) { return Math.min(Math.max(i, 0), options.length - 1); }
  function scrollToIndex(i, smooth) {
    scroll.scrollTo({ top: i * WHEEL_ITEM_H, behavior: smooth ? "smooth" : "auto" });
  }
  function commit(i, silent) {
    idx = i;
    hidden.value = options[i].value;
    markCenter(i);
    if (!silent) hidden.dispatchEvent(new Event("input", { bubbles: true }));
  }

  let settle;
  scroll.addEventListener("scroll", () => {
    clearTimeout(settle);
    markCenter(clampIndex(Math.round(scroll.scrollTop / WHEEL_ITEM_H)));
    settle = setTimeout(() => commit(clampIndex(Math.round(scroll.scrollTop / WHEEL_ITEM_H))), 130);
  });

  commit(idx, true); // 初期値をセット(イベントは出さない)
  container._reposition = () => requestAnimationFrame(() => scrollToIndex(idx, false));
  container._setValue = (val) => {
    let i = options.findIndex(o => String(o.value) === String(val));
    if (i < 0) i = 0;
    commit(i, true);
    requestAnimationFrame(() => scrollToIndex(i, false));
  };
  container._reposition();
}

// ---- 画面描画 ----
const app = document.getElementById("app");

const FORM_FIELD_IDS = ["f-date", "f-start", "f-end", "f-break", "f-hours", "f-mins", "f-wage", "f-daily-wage", "f-transport"];

// 削除など他の操作で再描画が起きても、入力中の勤務記録フォームの内容を保つ
function captureFormState() {
  const form = document.getElementById("entryForm");
  if (!form) return null;
  const state = {};
  for (const id of FORM_FIELD_IDS) state[id] = form.querySelector("#" + id)?.value ?? "";
  state.payType = form.querySelector('input[name="payType"]:checked')?.value ?? "";
  state.inputMode = form.querySelector('input[name="inputMode"]:checked')?.value ?? "";
  return state;
}
function restoreFormState(state) {
  if (!state) return;
  const form = document.getElementById("entryForm");
  if (!form) return;
  // ホイールで選ぶ欄は、値を戻すだけでなくホイールの位置も合わせ直す
  const WHEEL_IDS = ["f-start", "f-end", "f-break", "f-hours", "f-mins"];
  for (const id of FORM_FIELD_IDS) {
    if (WHEEL_IDS.includes(id)) {
      const w = form.querySelector("#wheel-" + id);
      if (w && w._setValue) w._setValue(state[id]);
    } else {
      const input = form.querySelector("#" + id);
      if (input && state[id]) input.value = state[id];
    }
  }
  // 選択中だった給与の種類・入力方法も復元し、表示切り替えを再適用する
  const payRadio = state.payType && form.querySelector(`input[name="payType"][value="${state.payType}"]`);
  if (payRadio) payRadio.checked = true;
  const modeRadio = state.inputMode && form.querySelector(`input[name="inputMode"][value="${state.inputMode}"]`);
  if (modeRadio) modeRadio.checked = true;
  applyPayTypeToForm(form);
  applyInputModeToForm(form);
  updatePreview(form);
}

// preserveForm: 入力途中の内容を保つか。編集開始/保存後は false で作り直す。
function render(preserveForm = true) {
  const formState = preserveForm ? captureFormState() : null;
  const thisMonth = monthOf(todayStr());
  app.innerHTML = "";
  app.appendChild(renderSummary(thisMonth));
  app.appendChild(renderForm());
  app.appendChild(renderMonthEntries(thisMonth));
  app.appendChild(renderHistory(thisMonth));
  app.appendChild(renderSettings());
  if (preserveForm) restoreFormState(formState);
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
  const card = el("section", "card summary-card");
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

// 記録を追加/編集するフォーム
function renderForm() {
  const editing = editingId ? entries.find(x => x.id === editingId) : null;
  // 編集時はその記録の値を、新規時は設定・前回値を初期表示にする
  const v = editing ? {
    date: editing.date,
    payType: editing.payType,
    inputMode: editing.inputMode || "duration",
    start: editing.startTime || "",
    end: editing.endTime || "",
    brk: editing.breakMinutes || 0,
    hours: Math.floor((editing.minutes || 0) / 60),
    mins: (editing.minutes || 0) % 60,
    wage: editing.wage || "",
    dailyWage: editing.dailyWage || "",
    transport: editing.transport || 0,
  } : {
    date: todayStr(),
    payType: settings.lastPayType,
    inputMode: settings.lastInputMode,
    start: "", end: "", brk: settings.defaultBreak || 0,
    hours: 0, mins: 0,
    wage: settings.lastWage || "",
    dailyWage: settings.lastDailyWage || "",
    transport: settings.defaultTransport || 0,
  };

  const card = el("section", "card");
  if (editing) card.classList.add("editing");
  card.innerHTML = `
    <h2>${editing ? "勤務を編集する" : "勤務を記録する"}</h2>
    <form id="entryForm">
      <div class="form-grid">
        <div class="field full">
          <label>給与の種類</label>
          <div class="seg pay-type-toggle">
            <label><input type="radio" name="payType" value="hourly"> 時給</label>
            <label><input type="radio" name="payType" value="daily"> 日給</label>
          </div>
        </div>
        <div class="field full">
          <label>入力方法</label>
          <div class="seg input-mode-toggle">
            <label><input type="radio" name="inputMode" value="time"> 時刻で入力</label>
            <label><input type="radio" name="inputMode" value="duration"> 時間で入力</label>
          </div>
        </div>
        <div class="field full">
          <label for="f-date">日付</label>
          <input type="date" id="f-date">
        </div>

        <div class="field" id="time-start-field">
          <label>開始</label>
          <div class="wheel" id="wheel-f-start"></div>
          <input type="hidden" id="f-start">
        </div>
        <div class="field" id="time-end-field">
          <label>終了</label>
          <div class="wheel" id="wheel-f-end"></div>
          <input type="hidden" id="f-end">
        </div>
        <div class="field" id="time-break-field">
          <label>休憩</label>
          <div class="wheel" id="wheel-f-break"></div>
          <input type="hidden" id="f-break">
        </div>

        <div class="field full" id="dur-field">
          <label>働いた時間</label>
          <div class="time-inputs">
            <div class="wheel" id="wheel-f-hours"></div>
            <span>時間</span>
            <div class="wheel" id="wheel-f-mins"></div>
            <span>分</span>
          </div>
          <input type="hidden" id="f-hours">
          <input type="hidden" id="f-mins">
        </div>

        <div class="field" id="wage-field">
          <label for="f-wage">時給(円)</label>
          <input type="number" id="f-wage" min="0" step="1" inputmode="numeric" value="${v.wage}">
        </div>
        <div class="field" id="daily-wage-field">
          <label for="f-daily-wage">日給(円)</label>
          <input type="number" id="f-daily-wage" min="0" step="1" inputmode="numeric" value="${v.dailyWage}">
        </div>
        <div class="field" id="transport-field">
          <label for="f-transport">交通費(円)</label>
          <input type="number" id="f-transport" min="0" step="1" inputmode="numeric" value="${v.transport}">
        </div>
      </div>

      <div class="calc-preview" id="calc-preview"></div>

      <button type="submit" class="btn-primary">${editing ? "更新する" : "この勤務を追加"}</button>
      ${editing ? '<button type="button" class="btn-cancel" id="cancelEdit">編集をやめる</button>' : ""}
    </form>`;

  const form = card.querySelector("#entryForm");
  form.querySelector("#f-date").value = v.date;

  // 回転ホイールを組み立てる(開始・終了・休憩・時間・分)
  buildWheel(form.querySelector("#wheel-f-start"), form.querySelector("#f-start"), timeWheelOptions(), v.start);
  buildWheel(form.querySelector("#wheel-f-end"), form.querySelector("#f-end"), timeWheelOptions(), v.end);
  buildWheel(form.querySelector("#wheel-f-break"), form.querySelector("#f-break"), breakWheelOptions(), v.brk);
  buildWheel(form.querySelector("#wheel-f-hours"), form.querySelector("#f-hours"), hoursWheelOptions(), v.hours);
  buildWheel(form.querySelector("#wheel-f-mins"), form.querySelector("#f-mins"), minsWheelOptions(), v.mins);

  // 給与の種類・入力方法の初期選択と、切り替え時の表示更新
  for (const radio of form.querySelectorAll('input[name="payType"]')) {
    radio.checked = radio.value === v.payType;
    radio.addEventListener("change", () => { applyPayTypeToForm(form); updatePreview(form); });
  }
  for (const radio of form.querySelectorAll('input[name="inputMode"]')) {
    radio.checked = radio.value === v.inputMode;
    radio.addEventListener("change", () => { applyInputModeToForm(form); updatePreview(form); });
  }
  applyPayTypeToForm(form);
  applyInputModeToForm(form);

  // どの欄を変えても、計算結果のプレビューを更新する
  for (const id of ["f-start", "f-end", "f-break", "f-hours", "f-mins", "f-wage", "f-daily-wage", "f-transport"]) {
    form.querySelector("#" + id).addEventListener("input", () => updatePreview(form));
  }
  updatePreview(form);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    addEntryFromForm(form);
  });
  const cancel = form.querySelector("#cancelEdit");
  if (cancel) cancel.addEventListener("click", () => { editingId = null; render(false); });

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
}

// 入力方法(時刻/時間)に合わせて、表示する欄を切り替える
function applyInputModeToForm(form) {
  const mode = form.querySelector('input[name="inputMode"]:checked')?.value || "time";
  const isTime = mode === "time";
  form.querySelector("#time-start-field").style.display = isTime ? "" : "none";
  form.querySelector("#time-end-field").style.display = isTime ? "" : "none";
  form.querySelector("#time-break-field").style.display = isTime ? "" : "none";
  form.querySelector("#dur-field").style.display = isTime ? "none" : "";
  // 表示に切り替わったホイールは、非表示中は位置を合わせられないので今ここで合わせる
  const visible = isTime ? ["wheel-f-start", "wheel-f-end", "wheel-f-break"] : ["wheel-f-hours", "wheel-f-mins"];
  for (const id of visible) {
    const w = form.querySelector("#" + id);
    if (w && w._reposition) w._reposition();
  }
}

// フォームの入力値から勤務時間・金額を読み取る(プレビューと保存で共用)
function readForm(form) {
  const payType = form.querySelector('input[name="payType"]:checked')?.value || "hourly";
  const inputMode = form.querySelector('input[name="inputMode"]:checked')?.value || "time";
  const date = form.querySelector("#f-date").value;
  const wage = parseInt(form.querySelector("#f-wage").value, 10) || 0;
  const dailyWage = parseInt(form.querySelector("#f-daily-wage").value, 10) || 0;
  const transport = parseInt(form.querySelector("#f-transport").value, 10) || 0;

  let minutes, startTime = "", endTime = "", breakMinutes = 0;
  if (inputMode === "time") {
    startTime = form.querySelector("#f-start").value;
    endTime = form.querySelector("#f-end").value;
    breakMinutes = parseInt(form.querySelector("#f-break").value, 10) || 0;
    if (!startTime || !endTime) {
      minutes = NaN; // 開始・終了のどちらか未選択(未入力)
    } else {
      let start = timeToMin(startTime);
      let end = timeToMin(endTime);
      if (end <= start) end += 24 * 60; // 夜勤: 終了が開始以前なら翌日とみなす
      minutes = (end - start) - breakMinutes;
    }
  } else {
    const hours = parseInt(form.querySelector("#f-hours").value, 10) || 0;
    const mins = parseInt(form.querySelector("#f-mins").value, 10) || 0;
    minutes = hours * 60 + mins;
  }
  return { payType, inputMode, date, minutes, wage, dailyWage, transport, startTime, endTime, breakMinutes };
}

// 入力中の内容から金額・時間を計算して表示する
function updatePreview(form) {
  const box = form.querySelector("#calc-preview");
  if (!box) return;
  const r = readForm(form);

  if (r.inputMode === "time" && Number.isNaN(r.minutes)) {
    box.innerHTML = `<span class="hint">開始と終了の時刻を選ぶと、ここに計算結果が出ます。</span>`;
    return;
  }
  if (r.inputMode === "time" && r.minutes < 0) {
    box.innerHTML = `<span class="warn">休憩が勤務時間より長くなっています。</span>`;
    return;
  }
  const breakText = r.inputMode === "time" && r.breakMinutes
    ? `(休憩${minutesToText(r.breakMinutes)})` : "";
  const timeText = r.minutes > 0 ? `${minutesToText(r.minutes)}${breakText}` : "";

  let labor = 0, ready = false;
  if (r.payType === "hourly") {
    ready = r.wage > 0 && r.minutes > 0;
    labor = Math.round(r.wage * r.minutes / 60);
  } else {
    ready = r.dailyWage > 0;
    labor = r.dailyWage;
  }
  if (!ready) {
    box.innerHTML = `<span class="hint">金額を入力すると、ここに計算結果が出ます。</span>`;
    return;
  }
  const total = labor + r.transport;
  const transText = r.transport ? ` <span class="sub">(交通費込み)</span>` : "";
  const detail = timeText ? `<span class="sub">${timeText}</span>` : "";
  box.innerHTML = `<span class="amount">${yen(total)}</span>${transText} ${detail}`;
}

function addEntryFromForm(form) {
  const r = readForm(form);

  if (!r.date) { alert("日付を入力してください。"); return; }
  if (r.inputMode === "time" && (!r.startTime || !r.endTime)) {
    alert("開始と終了の時刻を選んでください。"); return;
  }
  if (r.inputMode === "time" && r.minutes < 0) {
    alert("休憩が勤務時間より長くなっています。時刻か休憩を見直してください。"); return;
  }
  if (r.payType === "hourly") {
    // 時給: 金額×時間で計算するので、時間と時給が必須
    if (r.minutes <= 0) { alert("働いた時間を入力してください。"); return; }
    if (r.wage <= 0) { alert("時給を入力してください。"); return; }
  } else {
    // 日給: 固定額なので日給の金額だけ必須(時間は任意)
    if (r.dailyWage <= 0) { alert("日給を入力してください。"); return; }
    if (r.minutes < 0) { alert("働いた時間が正しくありません。"); return; }
  }
  if (r.transport < 0) { alert("交通費は0円以上を入力してください。"); return; }

  const data = {
    date: r.date,
    minutes: r.minutes,
    wage: r.wage,
    dailyWage: r.dailyWage,
    payType: r.payType,
    transport: r.transport,
    inputMode: r.inputMode,
    startTime: r.inputMode === "time" ? r.startTime : "",
    endTime: r.inputMode === "time" ? r.endTime : "",
    breakMinutes: r.inputMode === "time" ? r.breakMinutes : 0,
  };

  if (editingId) {
    // 編集: 元の並び順とIDを保ったまま、その記録だけ差し替える
    entries = entries.map(e => (e.id === editingId ? { ...data, id: editingId } : e));
    editingId = null;
  } else {
    entries.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...data });
  }
  saveEntries(entries);

  // 次回の初期表示用に、選んだ種類・入力方法と金額・交通費を覚えておく
  settings.lastPayType = r.payType;
  settings.lastInputMode = r.inputMode;
  if (r.payType === "hourly") settings.lastWage = r.wage;
  else settings.lastDailyWage = r.dailyWage;
  settings.defaultTransport = r.transport;
  saveSettings(settings);

  render(false); // フォームを初期状態に戻す
}

// 記録の編集を始める(内容をフォームへ読み込む)
function startEdit(id) {
  editingId = id;
  render(false);
  const form = document.getElementById("entryForm");
  if (form) form.scrollIntoView({ behavior: "smooth", block: "center" });
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

// 記録1件の詳細テキスト(時刻モードなら「9:00〜18:00(休憩1時間)」のように出す)
function entryDetailText(e) {
  const transText = e.transport ? ` ・交通費${yen(e.transport)}` : "";
  let timePart;
  if (e.inputMode === "time" && e.startTime) {
    const brk = e.breakMinutes ? `(休憩${minutesToText(e.breakMinutes)})` : "";
    timePart = `${fmtTime(e.startTime)}〜${fmtTime(e.endTime)}${brk}`;
  } else if (e.minutes > 0) {
    timePart = minutesToText(e.minutes);
  } else {
    timePart = "";
  }
  const wagePart = e.payType === "daily" ? `日給${yen(e.dailyWage)}` : `時給${yen(e.wage)}`;
  const sep = timePart ? " ・" : "";
  return `${timePart}${sep}${wagePart}${transText}`;
}

function renderEntryRow(e) {
  const row = el("div", "entry");
  if (e.id === editingId) row.classList.add("row-editing");
  const info = el("div", "entry-info");
  const date = el("div", "date");
  date.textContent = formatDate(e.date);
  const detail = el("div", "detail");
  detail.textContent = entryDetailText(e);
  info.appendChild(date);
  info.appendChild(detail);

  const right = el("div", "entry-right");
  const amount = el("span", "entry-amount");
  amount.textContent = yen(totalPay(e));

  const edit = el("button", "icon-btn edit-btn");
  edit.type = "button";
  edit.title = "この記録を編集";
  edit.setAttribute("aria-label", "この記録を編集");
  edit.innerHTML = ICON_EDIT;
  edit.addEventListener("click", () => startEdit(e.id));

  const del = el("button", "icon-btn del-btn");
  del.type = "button";
  del.title = "この記録を削除";
  del.setAttribute("aria-label", "この記録を削除");
  del.innerHTML = ICON_DELETE;
  del.addEventListener("click", () => deleteEntry(e.id));

  right.appendChild(amount);
  right.appendChild(edit);
  right.appendChild(del);
  row.appendChild(info);
  row.appendChild(right);
  return row;
}

function deleteEntry(id) {
  if (!confirm("この記録を削除しますか？")) return;
  entries = entries.filter(e => e.id !== id);
  if (editingId === id) editingId = null;
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
    sum.innerHTML = `<span class="m-label">${Number(y)}年${Number(mm)}月 <span class="m-days">(${days}日)</span></span><span class="m-total">${yen(total)}</span>`;
    det.appendChild(sum);

    const detail = el("div", "history-detail");
    for (const e of monthEntries) detail.appendChild(renderEntryRow(e));
    det.appendChild(detail);
    card.appendChild(det);
  }
  return card;
}

// 設定(交通費・休憩の既定額)
function renderSettings() {
  const card = el("section", "card");
  card.innerHTML = `
    <h2>設定</h2>
    <div class="setting-row">
      <div class="field">
        <label for="s-transport">交通費の既定額(円 / 1回)</label>
        <input type="number" id="s-transport" min="0" step="1" inputmode="numeric" value="${settings.defaultTransport || 0}">
      </div>
    </div>
    <div class="setting-row">
      <div class="field">
        <label for="s-break">休憩の既定値(時刻で入力するとき)</label>
        <select id="s-break">${breakOptionsHTML(settings.defaultBreak || 0)}</select>
      </div>
    </div>
    <div class="setting-actions">
      <button id="s-save" class="btn-secondary">保存</button>
      <p class="saved-note" id="s-note"></p>
    </div>`;

  card.querySelector("#s-save").addEventListener("click", () => {
    const t = parseInt(card.querySelector("#s-transport").value, 10) || 0;
    if (t < 0) { alert("交通費は0円以上を入力してください。"); return; }
    const b = parseInt(card.querySelector("#s-break").value, 10) || 0;
    settings.defaultTransport = t;
    settings.defaultBreak = b;
    saveSettings(settings);
    card.querySelector("#s-note").textContent = "保存しました(次に勤務を記録するときの初期値になります)";
    // 表示中のフォームがあれば、入力中の内容を消さずにその場で既定値を反映する
    const transportInput = document.getElementById("f-transport");
    if (transportInput && !editingId) transportInput.value = t;
    const breakInput = document.getElementById("f-break");
    if (breakInput && !editingId) breakInput.value = b;
  });
  return card;
}

// ---- 小さなユーティリティ ----
const ICON_EDIT = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_DELETE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

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
  editingId = null;
  saveEntries(entries);
  render();
});

// ---- 起動 ----
render();
