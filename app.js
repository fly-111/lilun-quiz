/* 理论闯关 · 遗忘曲线刷题 —— SM-2 精简版调度
 * 答对(会了) → 间隔按难度系数拉长；答对(蒙的) → 间隔归 1 天；答错 → 间隔归 1 天
 * 进度存 localStorage，纯静态可 GitHub Pages 部署
 */
(function () {
  "use strict";

  const DAY = 86400000;
  const MASTER_AT = 30;            // 间隔 >= 30 天视为「已掌握」
  const LS_STATE = "lilun-quiz-state-v1";
  const LS_SETTINGS = "lilun-quiz-settings-v1";
  const LS_STREAK = "lilun-quiz-streak-v1";

  const QUESTIONS = (window.QUIZ_DATA && window.QUIZ_DATA.questions) || [];
  const QMAP = {};
  QUESTIONS.forEach((q) => { QMAP[q.id] = q; });

  function loadJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function $(id) { return document.getElementById(id); }

  let state = loadJSON(LS_STATE, {});
  let settings = Object.assign({ newPerDay: 20 }, loadJSON(LS_SETTINGS, {}));
  let streak = loadJSON(LS_STREAK, { days: 0, last: null });

  function saveState() { saveJSON(LS_STATE, state); }
  function card(qid) {
    if (!state[qid]) state[qid] = { reps: 0, interval: 0, ease: 2.5, lapses: 0, due: 0, seen: 0, right: 0 };
    return state[qid];
  }
  function newIds() { return QUESTIONS.filter((q) => !state[q.id]).map((q) => q.id); }
  function dueIds() { const now = Date.now(); return QUESTIONS.filter((q) => state[q.id] && state[q.id].due && state[q.id].due <= now).map((q) => q.id); }
  function masteredCount() { return Object.values(state).filter((c) => c.interval >= MASTER_AT).length; }
  function learnedCount() { return Object.keys(state).length; }

  /* ---------- 调度核心 ---------- */
  function grade(qid, g) { // g: 'good' | 'fuzzy' | 'again'
    const c = card(qid);
    c.seen++;
    if (g === "again") {
      c.reps = 0; c.interval = 1; c.lapses++;
      c.ease = Math.max(1.3, c.ease - 0.2);
    } else if (g === "fuzzy") {
      c.interval = 1; c.right++;        // 对了但没把握：明天再见，不计错误
    } else {                             // good
      if (c.reps === 0) c.interval = 1;
      else if (c.reps === 1) c.interval = 3;
      else c.interval = Math.max(1, Math.round(c.interval * c.ease));
      c.reps++; c.right++;
      c.ease = Math.min(3.0, c.ease + 0.1);
    }
    c.due = Date.now() + c.interval * DAY;
    saveState();
  }

  function touchStreak() {
    const today = new Date().toISOString().slice(0, 10);
    if (streak.last === today) return;
    const yest = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    streak.days = (streak.last === yest) ? streak.days + 1 : 1;
    streak.last = today;
    saveJSON(LS_STREAK, streak);
  }

  /* ---------- 会话 ---------- */
  let session = null;   // { list: [qid...], idx, done }
  function buildSession() {
    const news = shuffle(newIds()).slice(0, settings.newPerDay);
    const dues = shuffle(dueIds());
    session = { list: news.concat(dues), idx: 0, done: 0 };
  }

  /* ---------- 渲染 ---------- */
  let phase = "answering";     // answering | revealed
  let selection = new Set();
  let currentCorrect = false;

  function show(id) { ["home", "quiz"].forEach((v) => $(v).classList.toggle("hidden", v !== id)); }

  function renderHome() {
    const dueN = dueIds().length, newN = newIds().length;
    $("stat-due").textContent = dueN;
    $("stat-new").textContent = Math.min(newN, settings.newPerDay);
    $("stat-master").textContent = masteredCount();
    $("stat-streak").textContent = streak.days;
    $("stat-total").textContent = QUESTIONS.length + " 题 · 已学 " + learnedCount();
    $("new-input").value = settings.newPerDay;
  }

  function renderQuiz() {
    if (!session || session.idx >= session.list.length) return renderDone();
    const q = QMAP[session.list[session.idx]];
    if (!q) { session.idx++; return renderQuiz(); }

    phase = "answering"; selection = new Set(); currentCorrect = false;
    $("q-progress").textContent = "第 " + (session.idx + 1) + "/" + session.list.length + " 题";
    $("q-type").textContent = q.type === "single" ? "单选题" : "多选题（选所有正确项）";
    $("q-stem").textContent = q.stem;
    $("q-result").className = "result hidden";
    $("q-mnemonic").textContent = "";
    $("q-mnemonic-box").classList.add("hidden");
    $("submit-btn").classList.toggle("hidden", q.type === "single");
    $("grade-good").classList.add("hidden");
    $("grade-fuzzy").classList.add("hidden");
    $("grade-again").classList.add("hidden");

    const opts = $("options");
    opts.innerHTML = "";
    const itype = q.type === "single" ? "radio" : "checkbox";
    q.options.forEach((t, i) => {
      const b = document.createElement("div");
      b.className = "opt";
      b.innerHTML = '<input type="' + itype + '" name="opt">'
        + '<span class="letter">' + String.fromCharCode(65 + i) + "</span>"
        + '<span class="txt">' + esc(t) + "</span>";
      b.onclick = () => onOption(i);
      opts.appendChild(b);
    });
    opts.dataset.multi = q.type === "multi" ? "1" : "";
  }

  function syncMarks(sel) {
    const btns = $("options").children;
    for (let k = 0; k < btns.length; k++) {
      const inp = btns[k].querySelector("input");
      if (inp) inp.checked = sel.has(k);
      btns[k].classList.toggle("selected", sel.has(k));
    }
  }
  function onOption(i) {
    if (phase !== "answering") return;
    const q = QMAP[session.list[session.idx]];
    if (q.type === "single") { selection = new Set([i]); syncMarks(selection); submit(); }
    else {
      if (selection.has(i)) selection.delete(i); else selection.add(i);
      syncMarks(selection);
    }
  }

  function submit() {
    if (phase !== "answering" || selection.size === 0) return;
    const q = QMAP[session.list[session.idx]];
    const correct = q.type === "single"
      ? selection.has(q.answer[0])
      : (selection.size === q.answer.length && q.answer.every((a) => selection.has(a)));
    currentCorrect = correct;
    phase = "revealed";

    const btns = $("options").children;
    q.answer.forEach((a) => {
      const inp = btns[a].querySelector("input");
      if (inp) inp.checked = true;
      btns[a].classList.add("right");
    });
    selection.forEach((s) => { if (!q.answer.includes(s)) btns[s].classList.add("wrong"); });

    const res = $("q-result");
    res.className = "result " + (correct ? "ok" : "bad");
    res.textContent = correct ? "✓ 答对了" : "✗ 答错了";
    $("submit-btn").classList.add("hidden");

    if (q.mnemonic) { $("q-mnemonic").textContent = q.mnemonic; $("q-mnemonic-box").classList.remove("hidden"); }

    if (correct) { $("grade-good").classList.remove("hidden"); $("grade-fuzzy").classList.remove("hidden"); }
    else $("grade-again").classList.remove("hidden");
  }

  function advance(g) {
    const qid = session.list[session.idx];
    grade(qid, g);
    touchStreak();
    session.idx++; session.done++;
    if (session.idx >= session.list.length) { session = null; renderDone(); }
    else renderQuiz();
  }

  function renderDone() {
    $("quiz").classList.add("hidden");
    $("done").classList.remove("hidden");
    $("done-master").textContent = masteredCount();
    $("done-due").textContent = dueIds().length;
    $("done-new").textContent = Math.min(newIds().length, settings.newPerDay);
  }

  function startSession() {
    settings.newPerDay = Math.max(1, parseInt($("new-input").value, 10) || 20);
    saveJSON(LS_SETTINGS, settings);
    buildSession();
    if (session.list.length === 0) { renderDone(); return; }
    $("done").classList.add("hidden");
    $("quiz").classList.remove("hidden");
    show("quiz");
    renderQuiz();
  }

  /* ---------- 键盘 ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName === "INPUT") return;
    if ($("quiz").classList.contains("hidden")) return;
    const k = e.key;
    if (phase === "answering") {
      if (/^[A-Da-d1-4]$/.test(k)) {
        const ch = k.toUpperCase();
        onOption(ch >= "A" && ch <= "D" ? ch.charCodeAt(0) - 65 : parseInt(ch, 10) - 1);
      } else if (k === "Enter" && QMAP[session.list[session.idx]].type === "multi") submit();
    } else if (phase === "revealed") {
      if (k === "Enter") advance(currentCorrect ? "good" : "again");
      else if (k === " " && currentCorrect) { e.preventDefault(); advance("fuzzy"); }
    }
  });

  /* ---------- 导出 / 导入 ---------- */
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ state, settings, streak }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lilun-quiz-progress.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (d.state) { state = d.state; saveState(); }
        if (d.settings) { settings = Object.assign(settings, d.settings); saveJSON(LS_SETTINGS, settings); }
        if (d.streak) { streak = d.streak; saveJSON(LS_STREAK, streak); }
        renderHome();
      } catch (err) { alert("导入失败：文件格式不对"); }
    };
    r.readAsText(file);
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  /* ---------- 事件绑定 ---------- */
  $("start-btn").onclick = startSession;
  $("submit-btn").onclick = submit;
  $("grade-good").onclick = () => advance("good");
  $("grade-fuzzy").onclick = () => advance("fuzzy");
  $("grade-again").onclick = () => advance("again");
  $("back-home").onclick = () => { session = null; show("home"); renderHome(); };
  $("done-home").onclick = () => { show("home"); renderHome(); };
  $("export-btn").onclick = exportJSON;
  $("import-btn").onclick = () => $("import-file").click();
  $("import-file").onchange = (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; };
  $("new-input").onchange = () => { settings.newPerDay = Math.max(1, parseInt($("new-input").value, 10) || 20); saveJSON(LS_SETTINGS, settings); renderHome(); };

  /* ---------- 启动 ---------- */
  renderHome();
  show("home");
})();
