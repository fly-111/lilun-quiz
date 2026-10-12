/* 理论闯关 · 遗忘曲线刷题 —— SM-2 精简版调度
 * 答对(会了) → 间隔按难度系数拉长；答对(蒙的) → 间隔归 1 天；答错 → 间隔归 1 天
 * 进度存 localStorage，纯静态可 GitHub Pages 部署
 * 页面还原 WTS 做题场景；含错题排行榜 / 专题前后翻题+增删题 / 题库总览
 */
(function () {
  "use strict";

  const DAY = 86400000;
  const MASTER_AT = 30;            // 间隔 >= 30 天视为「已掌握」
  const LS_STATE = "lilun-quiz-state-v1";
  const LS_SETTINGS = "lilun-quiz-settings-v1";
  const LS_STREAK = "lilun-quiz-streak-v1";
  const LS_TOPICS = "lilun-quiz-topics-v1";
  const LS_OVERRIDES = "lilun-quiz-topic-overrides-v1";
  const BANK_PAGE = 40;

  const QUESTIONS = (window.QUIZ_DATA && window.QUIZ_DATA.questions) || [];
  const QMAP = {};
  QUESTIONS.forEach((q) => { QMAP[q.id] = q; });

  /* 预置专题：suffix=按「选项」后缀归类（选词题）；keywords=题干/选项包含任一即匹配 */
  const TOPICS = [
    { name: "…性 选词", suffix: "性", desc: "选项是「先进性/纯洁性/人民性…」，选对/选全" },
    { name: "…化 选词", suffix: "化", desc: "选项是「现代化/信息化/智能化/绿色化…」" },
    { name: "…力 选词", suffix: "力", desc: "选项是「凝聚力/战斗力/创造力/引领力…」" },
    { name: "…观 选词", suffix: "观", desc: "选项是「世界观/人生观/价值观/大局观…」" },
    { name: "国际关系·外交", keywords: ["国际关系","外交","建交","大使","联合国","多边","单边","一带一路","命运共同体","全球","世界"] },
    { name: "伙伴关系", keywords: ["伙伴关系","全天候","战略协作","全面战略","战略伙伴","战略互信","合作共赢","同盟"] },
    { name: "中朝关系", keywords: ["中朝","朝鲜","朝中","抗美援朝"] },
    { name: "全会·会议", keywords: ["二十大","二十届","全会","中央","人大","政协","代表大会"] },
    { name: "国防·军队", keywords: ["国防","军队","军事","官兵","军人","战备","练兵","强军","战区"] },
    { name: "经济·金融", keywords: ["经济","金融","货币","财政","产业","市场","就业","投资","消费"] },
    { name: "法治·法律", keywords: ["法治","法律","宪法","立法","依法","司法","法规"] },
    { name: "生态·环境", keywords: ["生态","环境","绿色","碳","植树","污染","环保","气候"] },
    { name: "科技·创新", keywords: ["科技","创新","科学","技术","研发","人工智能","数字","芯片","人才"] }
  ];

  function loadJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function letter(i) { return String.fromCharCode(65 + i); }

  let state = loadJSON(LS_STATE, {});
  let settings = Object.assign({ newPerDay: 20 }, loadJSON(LS_SETTINGS, {}));
  let streak = loadJSON(LS_STREAK, { days: 0, last: null });
  let customTopics = loadJSON(LS_TOPICS, []);
  let overrides = loadJSON(LS_OVERRIDES, {});   // { 专题名: { removed:[qid], added:[qid] } }

  function saveState() { saveJSON(LS_STATE, state); }
  function saveOverrides() { saveJSON(LS_OVERRIDES, overrides); }
  function ovFor(t) {
    if (!overrides[t.name]) overrides[t.name] = { removed: [], added: [] };
    return overrides[t.name];
  }

  function card(qid) {
    if (!state[qid]) state[qid] = { reps: 0, interval: 0, ease: 2.5, lapses: 0, due: 0, seen: 0, right: 0 };
    return state[qid];
  }
  function newIds() { return QUESTIONS.filter((q) => !state[q.id]).map((q) => q.id); }
  function dueIds() { const now = Date.now(); return QUESTIONS.filter((q) => state[q.id] && state[q.id].due && state[q.id].due <= now).map((q) => q.id); }
  function futureIds() { const now = Date.now(); return QUESTIONS.filter((q) => state[q.id] && state[q.id].due && state[q.id].due > now).map((q) => q.id); }
  function weakIds() { return QUESTIONS.filter((q) => state[q.id] && state[q.id].lapses >= 2).map((q) => q.id); }
  function masteredCount() { return Object.values(state).filter((c) => c.interval >= MASTER_AT).length; }
  function learnedCount() { return Object.keys(state).length; }

  /* ---------- 专题匹配（含增删覆盖） ---------- */
  function baseMatch(q, t) {
    if (t.suffix) {
      const re = new RegExp("[一-龥]{1,4}" + t.suffix + "$");
      return q.options.filter((o) => re.test(o)).length >= 2;
    }
    if (t.keywords && t.keywords.length) {
      const hay = q.stem + " " + q.options.join(" ");
      return t.keywords.some((k) => hay.indexOf(k) >= 0);
    }
    return false;
  }
  function topicIds(t) {
    const base = new Set();
    QUESTIONS.forEach((q) => { if (baseMatch(q, t)) base.add(q.id); });
    const ov = ovFor(t);
    (ov.added || []).forEach((id) => base.add(id));
    (ov.removed || []).forEach((id) => base.delete(id));
    return [...base];
  }
  function allTopics() { return TOPICS.concat(customTopics); }
  function findTopic(name) { return allTopics().find((t) => t.name === name); }

  /* ---------- SM-2 调度 ---------- */
  function applyGrade(qid, g) { // g: 'good' | 'fuzzy' | 'again'
    const c = card(qid);
    c.seen++;
    if (g === "again") {
      c.reps = 0; c.interval = 1; c.lapses++;
      c.ease = Math.max(1.3, c.ease - 0.2);
    } else if (g === "fuzzy") {
      c.interval = 1; c.right++;
    } else {
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
  let session = null;   // { list:[qid], idx, mode, arg, rec:{qid:{sel,correct,graded}} }
  function buildSession(mode, arg) {
    let list;
    if (mode === "topic") list = shuffle(topicIds(arg));
    else if (mode === "weak") list = shuffle(weakIds());
    else {
      const news = shuffle(newIds()).slice(0, settings.newPerDay);
      const dues = shuffle(dueIds());
      list = news.concat(dues);
    }
    session = { list: list, idx: 0, done: 0, mode: mode || "normal", arg: arg || null, rec: {} };
  }

  /* ---------- 渲染：通用 ---------- */
  let phase = "answering";
  let selection = new Set();
  let currentCorrect = false;

  function show(id) { ["home", "quiz", "done", "stats", "bank", "addq"].forEach((v) => $(v).classList.toggle("hidden", v !== id)); }

  function renderHome() {
    const dueN = dueIds().length, newN = newIds().length, weakN = weakIds().length;
    $("stat-due").textContent = dueN;
    $("stat-tomorrow").textContent = futureIds().length;
    $("stat-new").textContent = Math.min(newN, settings.newPerDay);
    $("stat-master").textContent = masteredCount();
    $("stat-total").textContent = "已学 " + learnedCount() + " · 薄弱 " + weakN + " · 连续 " + streak.days + " 天";
    $("foot-count").textContent = QUESTIONS.length;
    $("new-input").value = settings.newPerDay;
    $("weak-btn").textContent = "薄弱题训练（错 ≥2 次 · " + weakN + " 道）";
    renderTopics();
  }

  function renderTopics() {
    const host = $("topic-list");
    host.innerHTML = "";
    allTopics().forEach((t) => {
      const n = topicIds(t).length;
      const b = document.createElement("button");
      b.className = "topic-btn";
      b.innerHTML = esc(t.name) + ' <span class="tc">' + n + ' 题</span>';
      b.title = t.desc || t.keywords.join("、");
      b.onclick = () => { buildSession("topic", t); startQuizView(); };

      const add = document.createElement("span");
      add.className = "topic-add2";
      add.textContent = "＋";
      add.title = "加题到该专题";
      add.onclick = (e) => { e.stopPropagation(); openAddq(t); };
      b.appendChild(add);

      if (t.custom) {
        const x = document.createElement("span");
        x.className = "topic-del";
        x.textContent = "×";
        x.title = "删除专题";
        x.onclick = (e) => { e.stopPropagation(); customTopics = customTopics.filter((c) => c !== t); saveJSON(LS_TOPICS, customTopics); delete overrides[t.name]; saveOverrides(); renderHome(); };
        b.appendChild(x);
      }
      host.appendChild(b);
    });
  }

  /* ---------- 渲染：答题 ---------- */
  function renderQuiz() {
    if (!session || session.list.length === 0) return renderDone();
    if (session.idx < 0) session.idx = 0;
    if (session.idx >= session.list.length) { session.idx = session.list.length - 1; }
    const qid = session.list[session.idx];
    const q = QMAP[qid];
    if (!q) { session.list.splice(session.idx, 1); return renderQuiz(); }

    const rec = session.rec[qid];
    phase = rec ? "revealed" : "answering";
    selection = rec ? new Set(rec.sel) : new Set();
    currentCorrect = rec ? rec.correct : false;

    $("q-progress").textContent = "第 " + (session.idx + 1) + "/" + session.list.length + " 题";
    $("q-order").textContent = session.idx + 1;
    $("q-type").textContent = q.type === "single" ? "单选题" : "多选题";
    const c = state[qid];
    $("q-hist").textContent = (c && c.seen) ? "对 " + c.right + " · 错 " + c.lapses : "";
    $("q-hist").classList.toggle("hidden", !c || !c.seen);
    $("q-graded").classList.toggle("hidden", !(rec && rec.graded));
    $("q-stem").textContent = q.stem;
    $("q-mnemonic").textContent = "";
    $("q-mnemonic-box").classList.add("hidden");
    $("remove-topic-btn").classList.toggle("hidden", session.mode !== "topic");

    // 选项文字列表
    const box = $("q-option-text");
    box.innerHTML = "";
    q.options.forEach((t, i) => {
      const u = document.createElement("div");
      u.className = "wts-select-unit";
      u.innerHTML = '<div class="ltr">' + letter(i) + '.</div><div class="otxt">' + esc(t) + "</div>";
      u.onclick = () => onOption(i);
      box.appendChild(u);
    });

    // 答案区
    const itype = q.type === "single" ? "radio" : "checkbox";
    const ans = $("q-answer");
    ans.innerHTML = "";
    q.options.forEach((t, i) => {
      const li = document.createElement("li");
      li.innerHTML = '<span class="altr">' + letter(i) + '</span><input type="' + itype + '" name="ans">';
      li.onclick = () => onOption(i);
      ans.appendChild(li);
    });

    // 前/后翻题
    $("prev-btn").disabled = session.idx <= 0;
    $("next-btn").disabled = session.idx >= session.list.length - 1;

    // 提交按钮 / 判题区
    $("submit-btn").classList.toggle("hidden", phase !== "answering");

    if (rec) {
      applyMarks(q, selection);
      $("q-result").className = "result " + (rec.correct ? "ok" : "bad");
      $("q-result").textContent = rec.correct ? "✓ 答对了" : "✗ 答错了";
      $("q-result").classList.remove("hidden");
      if (q.mnemonic) { $("q-mnemonic").textContent = q.mnemonic; $("q-mnemonic-box").classList.remove("hidden"); }
      if (rec.graded) {
        $("grade-good").classList.add("hidden");
        $("grade-fuzzy").classList.add("hidden");
        $("grade-again").classList.add("hidden");
      } else {
        if (rec.correct) { $("grade-good").classList.remove("hidden"); $("grade-fuzzy").classList.remove("hidden"); }
        else $("grade-again").classList.remove("hidden");
      }
    } else {
      $("q-result").classList.add("hidden");
      $("grade-good").classList.add("hidden");
      $("grade-fuzzy").classList.add("hidden");
      $("grade-again").classList.add("hidden");
    }
    syncMarks(selection);
  }

  function applyMarks(q, sel) {
    const units = $("q-option-text").children;
    for (let k = 0; k < units.length; k++) units[k].classList.remove("right", "wrong");
    q.answer.forEach((a) => units[a].classList.add("right"));
    sel.forEach((s) => { if (!q.answer.includes(s)) units[s].classList.add("wrong"); });
  }

  function syncMarks(sel) {
    const units = $("q-option-text").children;
    const lis = $("q-answer").children;
    for (let k = 0; k < units.length; k++) {
      units[k].classList.toggle("selected", sel.has(k));
      const inp = lis[k] && lis[k].querySelector("input");
      if (inp) inp.checked = sel.has(k);
    }
  }

  function onOption(i) {
    if (phase !== "answering") return;
    const q = QMAP[session.list[session.idx]];
    if (q.type === "single") { selection = new Set([i]); }
    else {
      if (selection.has(i)) selection.delete(i); else selection.add(i);
    }
    syncMarks(selection);
  }

  function submit() {
    if (phase !== "answering" || selection.size === 0) return;
    const q = QMAP[session.list[session.idx]];
    const correct = q.type === "single"
      ? selection.has(q.answer[0])
      : (selection.size === q.answer.length && q.answer.every((a) => selection.has(a)));
    session.rec[session.list[session.idx]] = { sel: [...selection], correct: correct, graded: false };
    renderQuiz();
  }

  function grade(g) {
    const qid = session.list[session.idx];
    const rec = session.rec[qid];
    if (!rec || rec.graded) return;
    applyGrade(qid, g);
    rec.graded = true;
    touchStreak();
    session.done++;
    advance();
  }

  function advance() {
    let n = session.idx + 1;
    while (n < session.list.length) {
      const r = session.rec[session.list[n]];
      if (!(r && r.graded)) break;    // 未答或未判分 → 停
      n++;
    }
    if (n >= session.list.length) { renderDone(); }
    else { session.idx = n; renderQuiz(); }
  }

  function prevQ() { if (session && session.idx > 0) { session.idx--; renderQuiz(); } }
  function nextQ() { if (session && session.idx < session.list.length - 1) { session.idx++; renderQuiz(); } }

  function removeCurrentFromTopic() {
    if (!session || session.mode !== "topic" || !session.arg) return;
    const qid = session.list[session.idx];
    const ov = ovFor(session.arg);
    if (ov.removed.indexOf(qid) < 0) ov.removed.push(qid);
    saveOverrides();
    session.list = session.list.filter((id) => id !== qid);
    delete session.rec[qid];
    if (session.list.length === 0) { session = null; show("home"); renderHome(); return; }
    if (session.idx >= session.list.length) session.idx = session.list.length - 1;
    renderQuiz();
  }

  function startQuizView() {
    if (session.list.length === 0) { renderDone(); return; }
    show("quiz");
    renderQuiz();
  }

  function renderDone() {
    show("done");
    $("done-master").textContent = masteredCount();
    $("done-due").textContent = futureIds().length;
    $("done-new").textContent = Math.min(newIds().length, settings.newPerDay);
  }

  /* ---------- 错题排行榜 ---------- */
  function renderStats() {
    const rows = QUESTIONS
      .filter((q) => state[q.id] && state[q.id].lapses > 0)
      .map((q) => ({ q: q, c: state[q.id] }))
      .sort((a, b) => b.c.lapses - a.c.lapses || b.c.right - a.c.right);
    const totalWrong = rows.reduce((s, r) => s + r.c.lapses, 0);
    const totalRight = Object.values(state).reduce((s, c) => s + (c.right || 0), 0);
    $("lb-overall").innerHTML = "已学 <b>" + learnedCount() + "</b> 题 · 累计答对 <b>" + totalRight + "</b> · 答错 <b>" + totalWrong + "</b> · 错题 <b>" + rows.length + "</b> 道";

    const host = $("lb-list");
    host.innerHTML = "";
    if (rows.length === 0) { host.innerHTML = '<div class="empty">还没有错题，去做几道吧</div>'; return; }
    rows.slice(0, 100).forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "lb-row";
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
      row.innerHTML =
        '<span class="lb-rank">' + medal + '</span>' +
        '<span class="lb-stem">' + esc(truncate(r.q.stem, 42)) + '</span>' +
        '<span class="lb-tag">' + (r.q.type === "single" ? "单选" : "多选") + '</span>' +
        '<span class="lb-num wrong">错 ' + r.c.lapses + '</span>' +
        '<span class="lb-num ok">对 ' + (r.c.right || 0) + '</span>';
      row.onclick = () => openSingleQuestion(r.q.id);
      host.appendChild(row);
    });
  }
  function truncate(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }

  /* ---------- 题库总览 ---------- */
  let bank = { kw: "", type: "all", page: 0 };
  function bankQuery() {
    let list = QUESTIONS;
    if (bank.type !== "all") list = list.filter((q) => q.type === bank.type);
    const kw = bank.kw.trim();
    if (kw) list = list.filter((q) => (q.stem + " " + q.options.join(" ")).indexOf(kw) >= 0);
    return list;
  }
  function renderBank() {
    const list = bankQuery();
    const pages = Math.max(1, Math.ceil(list.length / BANK_PAGE));
    if (bank.page >= pages) bank.page = pages - 1;
    const slice = list.slice(bank.page * BANK_PAGE, bank.page * BANK_PAGE + BANK_PAGE);
    $("bank-page").textContent = (bank.page + 1) + " / " + pages + " 页 · 共 " + list.length + " 题";
    $("bank-prev").disabled = bank.page <= 0;
    $("bank-next").disabled = bank.page >= pages - 1;

    const host = $("bank-list");
    host.innerHTML = "";
    if (list.length === 0) { host.innerHTML = '<div class="empty">没有匹配的题</div>'; return; }
    slice.forEach((q) => host.appendChild(questionCard(q)));
  }
  function questionCard(q) {
    const d = document.createElement("div");
    d.className = "qc " + (q.type === "single" ? "qc-single" : "qc-multi");
    const opts = q.options.map((o, i) =>
      '<div class="qc-opt' + (q.answer.includes(i) ? " ans" : "") + '"><span class="qc-l">' + letter(i) + '.</span>' + esc(o) + (q.answer.includes(i) ? " ✓" : "") + "</div>"
    ).join("");
    d.innerHTML =
      '<div class="qc-head"><span class="type">' + (q.type === "single" ? "单选" : "多选") + '</span><span class="qc-stem">' + esc(q.stem) + '</span></div>' +
      '<div class="qc-opts">' + opts + "</div>";
    return d;
  }

  /* ---------- 加题到专题 ---------- */
  let activeTopic = null;
  let addqKw = "";
  function openAddq(t) {
    activeTopic = t;
    addqKw = "";
    $("addq-title").textContent = "加题到「" + t.name + "」";
    $("addq-kw").value = "";
    show("addq");
    renderAddq();
  }
  function renderAddq() {
    const host = $("addq-list");
    host.innerHTML = "";
    const kw = addqKw.trim();
    const inTopic = new Set(topicIds(activeTopic));
    if (!kw) { host.innerHTML = '<div class="empty">输入关键词搜索题目（如：中俄 / 长征 / 生态…）</div>'; return; }
    const hits = QUESTIONS.filter((q) => (q.stem + " " + q.options.join(" ")).indexOf(kw) >= 0).slice(0, 60);
    if (hits.length === 0) { host.innerHTML = '<div class="empty">没有匹配的题，换个关键词</div>'; return; }
    hits.forEach((q) => {
      const d = document.createElement("div");
      d.className = "qc";
      const has = inTopic.has(q.id);
      d.innerHTML =
        '<div class="qc-head"><span class="type">' + (q.type === "single" ? "单选" : "多选") + '</span><span class="qc-stem">' + esc(truncate(q.stem, 60)) + '</span></div>' +
        '<div class="qc-add"><button class="btn ' + (has ? "ghost small" : "primary small") + '" ' + (has ? "disabled" : "") + '>' + (has ? "✓ 已在专题" : "加入专题") + "</button></div>";
      if (!has) d.querySelector("button").onclick = () => addToTopic(q.id);
      host.appendChild(d);
    });
  }
  function addToTopic(qid) {
    if (!activeTopic) return;
    const ov = ovFor(activeTopic);
    const ri = ov.removed.indexOf(qid);
    if (ri >= 0) ov.removed.splice(ri, 1);
    if (ov.added.indexOf(qid) < 0) ov.added.push(qid);
    saveOverrides();
    renderAddq();
  }

  /* ---------- 单题查看（排行榜点开） ---------- */
  function openSingleQuestion(qid) {
    const q = QMAP[qid];
    if (!q) return;
    session = { list: [qid], idx: 0, mode: "review", arg: null, rec: {} };
    show("quiz");
    renderQuiz();
  }

  /* ---------- 键盘 ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
    const quizVisible = !$("quiz").classList.contains("hidden");
    if (quizVisible) {
      const k = e.key;
      if (phase === "answering") {
        if (/^[A-Da-d1-4]$/.test(k)) {
          const ch = k.toUpperCase();
          onOption(ch >= "A" && ch <= "D" ? ch.charCodeAt(0) - 65 : parseInt(ch, 10) - 1);
        } else if (k === "Enter") submit();
        else if (k === "ArrowLeft") prevQ();
        else if (k === "ArrowRight") nextQ();
      } else if (phase === "revealed") {
        if (k === "Enter" && session.rec[session.list[session.idx]] && !session.rec[session.list[session.idx]].graded) {
          grade(currentCorrect ? "good" : "again");
        } else if (k === " " && currentCorrect && session.rec[session.list[session.idx]] && !session.rec[session.list[session.idx]].graded) {
          e.preventDefault(); grade("fuzzy");
        } else if (k === "ArrowLeft") prevQ();
        else if (k === "ArrowRight") nextQ();
      }
    }
  });

  /* ---------- 导出 / 导入 ---------- */
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ state, settings, streak, customTopics, overrides }, null, 2)], { type: "application/json" });
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
        if (d.customTopics) { customTopics = d.customTopics; saveJSON(LS_TOPICS, customTopics); }
        if (d.overrides) { overrides = d.overrides; saveOverrides(); }
        renderHome();
      } catch (err) { alert("导入失败：文件格式不对"); }
    };
    r.readAsText(file);
  }

  /* ---------- 事件绑定 ---------- */
  $("start-btn").onclick = () => { settings.newPerDay = Math.max(1, parseInt($("new-input").value, 10) || 20); saveJSON(LS_SETTINGS, settings); buildSession("normal"); startQuizView(); };
  $("weak-btn").onclick = () => { buildSession("weak"); startQuizView(); };
  $("submit-btn").onclick = submit;
  $("grade-good").onclick = () => grade("good");
  $("grade-fuzzy").onclick = () => grade("fuzzy");
  $("grade-again").onclick = () => grade("again");
  $("back-home").onclick = () => { session = null; show("home"); renderHome(); };
  $("remove-topic-btn").onclick = removeCurrentFromTopic;
  $("prev-btn").onclick = prevQ;
  $("next-btn").onclick = nextQ;

  $("done-home").onclick = () => { session = null; show("home"); renderHome(); };
  $("done-review").onclick = () => { if (session) { session.idx = 0; show("quiz"); renderQuiz(); } };

  $("stats-btn").onclick = () => { show("stats"); renderStats(); };
  $("stats-back").onclick = () => { show("home"); renderHome(); };

  $("bank-btn").onclick = () => { show("bank"); renderBank(); };
  $("bank-back").onclick = () => { show("home"); renderHome(); };
  $("bank-kw").oninput = () => { bank.kw = $("bank-kw").value; bank.page = 0; renderBank(); };
  $("bank-type").onchange = () => { bank.type = $("bank-type").value; bank.page = 0; renderBank(); };
  $("bank-prev").onclick = () => { bank.page--; renderBank(); };
  $("bank-next").onclick = () => { bank.page++; renderBank(); };

  $("addq-back").onclick = () => { show("home"); renderHome(); };
  $("addq-kw").oninput = () => { addqKw = $("addq-kw").value; renderAddq(); };

  $("export-btn").onclick = exportJSON;
  $("import-btn").onclick = () => $("import-file").click();
  $("import-file").onchange = (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; };
  $("new-input").onchange = () => { settings.newPerDay = Math.max(1, parseInt($("new-input").value, 10) || 20); saveJSON(LS_SETTINGS, settings); renderHome(); };

  $("topic-add-btn").onclick = () => $("topic-form").classList.remove("hidden");
  $("topic-cancel").onclick = () => { $("topic-form").classList.add("hidden"); $("topic-name").value = ""; $("topic-kw").value = ""; };
  $("topic-save").onclick = () => {
    const name = $("topic-name").value.trim();
    const kws = $("topic-kw").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (!name || !kws.length) { alert("请填写专题名称和至少一个关键词"); return; }
    if (findTopic(name)) { alert("已存在同名专题"); return; }
    customTopics.push({ name: name, keywords: kws, custom: true });
    saveJSON(LS_TOPICS, customTopics);
    $("topic-form").classList.add("hidden");
    $("topic-name").value = ""; $("topic-kw").value = "";
    renderHome();
  };

  /* ---------- 启动 ---------- */
  renderHome();
  show("home");
})();
