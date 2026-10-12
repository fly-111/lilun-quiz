/* 理论闯关 · 遗忘曲线刷题 —— SM-2 精简版调度
 * 答对(会了) → 间隔按难度系数拉长；答对(蒙的) → 间隔归 1 天；答错 → 间隔归 1 天
 * 进度存 localStorage，纯静态可 GitHub Pages 部署
 * 页面还原 WTS 做题场景：题干 → 选项文字列表(.wts-select-unit) → 答案区(.answerUnitViewBox)
 */
(function () {
  "use strict";

  const DAY = 86400000;
  const MASTER_AT = 30;            // 间隔 >= 30 天视为「已掌握」
  const LS_STATE = "lilun-quiz-state-v1";
  const LS_SETTINGS = "lilun-quiz-settings-v1";
  const LS_STREAK = "lilun-quiz-streak-v1";
  const LS_TOPICS = "lilun-quiz-topics-v1";

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

  let state = loadJSON(LS_STATE, {});
  let settings = Object.assign({ newPerDay: 20 }, loadJSON(LS_SETTINGS, {}));
  let streak = loadJSON(LS_STREAK, { days: 0, last: null });
  let customTopics = loadJSON(LS_TOPICS, []);

  function saveState() { saveJSON(LS_STATE, state); }
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

  /* ---------- 专题匹配 ---------- */
  function matchTopic(q, t) {
    if (t.suffix) {                       // 选词题：≥2 个选项以该后缀结尾
      const re = new RegExp("[一-龥]{1,4}" + t.suffix + "$");
      return q.options.filter((o) => re.test(o)).length >= 2;
    }
    if (t.keywords && t.keywords.length) {
      const hay = q.stem + " " + q.options.join(" ");
      return t.keywords.some((k) => hay.indexOf(k) >= 0);
    }
    return false;
  }
  function topicIds(t) { return QUESTIONS.filter((q) => matchTopic(q, t)).map((q) => q.id); }

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
  let session = null;   // { list: [qid...], idx, done, mode, arg }
  function buildSession(mode, arg) {
    let list;
    if (mode === "topic") list = shuffle(topicIds(arg));
    else if (mode === "weak") list = shuffle(weakIds());
    else {
      const news = shuffle(newIds()).slice(0, settings.newPerDay);
      const dues = shuffle(dueIds());
      list = news.concat(dues);
    }
    session = { list: list, idx: 0, done: 0, mode: mode || "normal", arg: arg || null };
  }

  /* ---------- 渲染 ---------- */
  let phase = "answering";     // answering | revealed
  let selection = new Set();
  let currentCorrect = false;

  function show(id) { ["home", "quiz", "done"].forEach((v) => $(v).classList.toggle("hidden", v !== id)); }

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
    TOPICS.concat(customTopics).forEach((t) => {
      const n = topicIds(t).length;
      const b = document.createElement("button");
      b.className = "topic-btn";
      b.textContent = t.name + " · " + n + " 题";
      b.title = t.desc || t.keywords.join("、");
      b.onclick = () => { buildSession("topic", t); startQuizView(); };
      if (t.custom) {
        const x = document.createElement("span");
        x.className = "topic-del";
        x.textContent = "×";
        x.title = "删除专题";
        x.onclick = (e) => { e.stopPropagation(); customTopics = customTopics.filter((c) => c !== t); saveJSON(LS_TOPICS, customTopics); renderHome(); };
        b.appendChild(x);
      }
      host.appendChild(b);
    });
  }

  function renderQuiz() {
    if (!session || session.idx >= session.list.length) return renderDone();
    const q = QMAP[session.list[session.idx]];
    if (!q) { session.idx++; return renderQuiz(); }

    phase = "answering"; selection = new Set(); currentCorrect = false;
    $("q-progress").textContent = "第 " + (session.idx + 1) + "/" + session.list.length + " 题";
    $("q-order").textContent = session.idx + 1;
    $("q-type").textContent = q.type === "single" ? "单选题" : "多选题";
    const c = state[q.id];
    $("q-hist").textContent = (c && c.seen) ? "对 " + c.right + " · 错 " + c.lapses : "";
    $("q-hist").classList.toggle("hidden", !c || !c.seen);
    $("q-stem").textContent = q.stem;
    $("q-result").className = "result hidden";
    $("q-mnemonic").textContent = "";
    $("q-mnemonic-box").classList.add("hidden");
    $("submit-btn").classList.remove("hidden");
    $("grade-good").classList.add("hidden");
    $("grade-fuzzy").classList.add("hidden");
    $("grade-again").classList.add("hidden");

    const itype = q.type === "single" ? "radio" : "checkbox";

    // 选项文字列表（.wts-select-unit）
    const box = $("q-option-text");
    box.innerHTML = "";
    q.options.forEach((t, i) => {
      const u = document.createElement("div");
      u.className = "wts-select-unit";
      u.innerHTML = '<div class="ltr">' + String.fromCharCode(65 + i) + '.</div><div class="otxt">' + esc(t) + "</div>";
      u.onclick = () => onOption(i);
      box.appendChild(u);
    });

    // 答案区（A B C D 横排 + 单选圆/多选方）
    const ans = $("q-answer");
    ans.innerHTML = "";
    q.options.forEach((t, i) => {
      const li = document.createElement("li");
      li.innerHTML = '<span class="altr">' + String.fromCharCode(65 + i) + '</span><input type="' + itype + '" name="ans">';
      li.onclick = () => onOption(i);
      ans.appendChild(li);
    });
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
    if (q.type === "single") { selection = new Set([i]); syncMarks(selection); }
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

    const units = $("q-option-text").children;
    q.answer.forEach((a) => units[a].classList.add("right"));
    selection.forEach((s) => { if (!q.answer.includes(s)) units[s].classList.add("wrong"); });

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
    show("done");
    $("done-master").textContent = masteredCount();
    $("done-due").textContent = futureIds().length;
    $("done-new").textContent = Math.min(newIds().length, settings.newPerDay);
  }

  function startQuizView() {
    if (session.list.length === 0) { renderDone(); return; }
    show("quiz");
    renderQuiz();
  }

  function startSession() {
    settings.newPerDay = Math.max(1, parseInt($("new-input").value, 10) || 20);
    saveJSON(LS_SETTINGS, settings);
    buildSession("normal");
    startQuizView();
  }

  /* ---------- 键盘 ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if ($("quiz").classList.contains("hidden")) return;
    const k = e.key;
    if (phase === "answering") {
      if (/^[A-Da-d1-4]$/.test(k)) {
        const ch = k.toUpperCase();
        onOption(ch >= "A" && ch <= "D" ? ch.charCodeAt(0) - 65 : parseInt(ch, 10) - 1);
      } else if (k === "Enter") submit();
    } else if (phase === "revealed") {
      if (k === "Enter") advance(currentCorrect ? "good" : "again");
      else if (k === " " && currentCorrect) { e.preventDefault(); advance("fuzzy"); }
    }
  });

  /* ---------- 导出 / 导入 ---------- */
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ state, settings, streak, customTopics }, null, 2)], { type: "application/json" });
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
        renderHome();
      } catch (err) { alert("导入失败：文件格式不对"); }
    };
    r.readAsText(file);
  }

  /* ---------- 事件绑定 ---------- */
  $("start-btn").onclick = startSession;
  $("weak-btn").onclick = () => { buildSession("weak"); startQuizView(); };
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

  $("topic-add-btn").onclick = () => $("topic-form").classList.remove("hidden");
  $("topic-cancel").onclick = () => { $("topic-form").classList.add("hidden"); $("topic-name").value = ""; $("topic-kw").value = ""; };
  $("topic-save").onclick = () => {
    const name = $("topic-name").value.trim();
    const kws = $("topic-kw").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (!name || !kws.length) { alert("请填写专题名称和至少一个关键词"); return; }
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
