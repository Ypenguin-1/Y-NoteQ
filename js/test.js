/* ============================================================
   Y-NoteQ test.js
   「テスト」タブ(tabs/test.html)の描画とデータ操作
   ・①設定画面: 出題範囲/数/向き/採点方式/対象Level/出題形式/Level表示/Level採点/制限時間
   ・②実施画面: 単語カード・4択・入力記述の3形式、進捗・タイマー表示
   ・③結果画面: 正答率、もう一度/間違えたのみ/終了、解答一覧(Level手動編集)、PDF出力
   ============================================================ */
window.TestTab = (function () {

  let allWords = [];       // 現在の単語帳の全単語
  let candidatePool = [];  // 設定画面の条件(No/Level)に合致する単語
  let settings = null;     // テスト開始時に確定した設定値
  let queue = [];          // 今回出題する単語の並び
  let currentIndex = 0;
  let answers = [];        // 各問題の解答結果

  let currentWord = null, currentAnswerField = null;
  let questionAnswered = false;

  const timer = { remaining: 0, intervalId: null };

  function wordsRef() { return YNQ.wordsCol(YNQ.currentFolder.id, YNQ.currentBook.id); }

  /* ---------- 初期表示 ---------- */
  function init() {
    const hasBook = !!(YNQ.currentFolder && YNQ.currentBook);
    document.getElementById("test-empty").hidden = hasBook;
    document.getElementById("test-screen-settings").hidden = !hasBook;
    document.getElementById("test-screen-running").hidden = true;
    document.getElementById("test-screen-result").hidden = true;
    if (!hasBook) {
      document.getElementById("btn-test-goto-folders").addEventListener("click", () => YNQ.loadTab("home"));
      return;
    }

    stopTimer();
    bindSettingsEvents();
    bindRunningEvents();
    bindResultEvents();
    loadWords();
  }

  async function loadWords() {
    document.getElementById("test-candidate-body").innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted);padding:20px;">読み込み中...</td></tr>`;
    try {
      const snap = await wordsRef().orderBy("no", "asc").get();
      allWords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCandidatePool();
    } catch (err) {
      console.error("[test:loadWords]", err);
      document.getElementById("test-candidate-body").innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--color-danger);padding:20px;">読み込みに失敗しました</td></tr>`;
    }
  }

  function showScreen(name) {
    document.getElementById("test-screen-settings").hidden = name !== "settings";
    document.getElementById("test-screen-running").hidden = name !== "running";
    document.getElementById("test-screen-result").hidden = name !== "result";
  }

  /* ---------- 共通ユーティリティ ---------- */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  // "apple | orange" のような複数正答表記の先頭だけを表示用に取り出す
  function firstAlt(str) { return String(str || "").split("|")[0].trim(); }
  // 複数正答をすべて取り出す(入力記述の採点で使用)
  function allAlts(str) { return String(str || "").split("|").map(s => s.trim()).filter(Boolean); }
  function todayFormatted() {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseNoQuery(str) {
    if (!str) return null;
    const ranges = []; const singles = new Set();
    str.split(",").map(s => s.trim()).filter(Boolean).forEach(token => {
      const m = token.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) ranges.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
      else if (/^\d+$/.test(token)) singles.add(parseInt(token, 10));
    });
    return (no) => singles.has(no) || ranges.some(([a, b]) => no >= Math.min(a, b) && no <= Math.max(a, b));
  }

  // ボタン群(単一選択/複数選択)の共通処理。「仕様#58: 設定はすべてボタンで機能」に対応
  function bindToggleGroup(containerId, singleSelect, onChange) {
    const wrap = document.getElementById(containerId);
    wrap.querySelectorAll(".btn-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        if (singleSelect) {
          wrap.querySelectorAll(".btn-toggle").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
        } else {
          btn.classList.toggle("active");
        }
        if (onChange) onChange();
      });
    });
  }
  function getToggleValue(containerId) {
    const active = document.querySelector(`#${containerId} .btn-toggle.active`);
    return active ? active.dataset.value : null;
  }
  function getToggleValues(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} .btn-toggle.active`)).map(b => b.dataset.value);
  }

  /* ============================================================
     ① 設定画面
     ============================================================ */
  function bindSettingsEvents() {
    bindToggleGroup("test-set-direction", true);
    bindToggleGroup("test-set-scoring-timing", true);
    bindToggleGroup("test-set-levels", false, updateCandidatePool);
    bindToggleGroup("test-set-format", true);
    bindToggleGroup("test-set-show-level", true);
    bindToggleGroup("test-set-level-scoring", true);
    bindToggleGroup("test-set-timelimit-mode", true, () => {
      document.getElementById("test-set-timelimit-seconds-wrap").hidden = (getToggleValue("test-set-timelimit-mode") === "none");
    });

    document.getElementById("test-set-no").addEventListener("input", updateCandidatePool);
    document.getElementById("btn-test-start").addEventListener("click", startTest);
    document.getElementById("btn-test-export-pdf").addEventListener("click", exportSettingsPdf);
  }

  function readSettings() {
    return {
      count: Math.max(1, parseInt(document.getElementById("test-set-count").value, 10) || 1),
      direction: getToggleValue("test-set-direction"),
      scoringTiming: getToggleValue("test-set-scoring-timing"),
      format: getToggleValue("test-set-format"),
      showLevel: getToggleValue("test-set-show-level") === "on",
      levelScoring: getToggleValue("test-set-level-scoring") === "on",
      timeLimitMode: getToggleValue("test-set-timelimit-mode"),
      timeLimitSeconds: Math.max(5, parseInt(document.getElementById("test-set-timelimit-seconds").value, 10) || 30)
    };
  }

  function updateCandidatePool() {
    const noPredicate = parseNoQuery(document.getElementById("test-set-no").value.trim());
    const levelValues = getToggleValues("test-set-levels").map(Number);
    candidatePool = allWords.filter(w => {
      if (noPredicate && !noPredicate(w.no)) return false;
      if (levelValues.length > 0 && !levelValues.includes(w.level || 0)) return false;
      return true;
    });
    renderCandidateTable();
  }

  function renderCandidateTable() {
    document.getElementById("test-candidate-count").textContent = `(${candidatePool.length}件)`;
    const tbody = document.getElementById("test-candidate-body");
    if (candidatePool.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted);padding:20px;">条件に合う単語がありません</td></tr>`;
      return;
    }
    tbody.innerHTML = candidatePool.map(w => {
      const level = w.level || 0;
      return `<tr>
        <td>${YNQ.pad4(w.no)}</td>
        <td class="col-word">${YNQ.escapeHtml(w.word)}</td>
        <td class="col-meaning">${YNQ.escapeHtml(w.meaning)}</td>
        <td><span class="level-pill" style="background:${YNQ.LEVEL_COLORS[level]};cursor:default;">${level}</span></td>
      </tr>`;
    }).join("");
  }

  async function exportSettingsPdf() {
    if (candidatePool.length === 0) { YNQ.showToast("出力できる単語がありません"); return; }
    const s = readSettings();
    const promptField = s.direction === "word2meaning" ? "word" : "meaning";
    const pool = shuffle(candidatePool.slice()).slice(0, Math.min(s.count, candidatePool.length));

    // 画面外に「問題+解答欄」だけの印刷用テーブルを一時生成してPDF化する
    const rows = pool.map((w, i) => `
      <tr>
        <td style="border:1px solid #ccc;padding:8px;">${i + 1}</td>
        <td style="border:1px solid #ccc;padding:8px;">${YNQ.pad4(w.no)}</td>
        <td style="border:1px solid #ccc;padding:8px;font-size:16px;">${YNQ.escapeHtml(firstAlt(w[promptField]))}</td>
        <td style="border:1px solid #ccc;padding:8px;width:220px;"></td>
      </tr>`).join("");
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;left:-9999px;top:0;background:#ffffff;color:#000000;padding:16px;width:700px;";
    wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
      <thead><tr>
        <th style="border:1px solid #ccc;padding:8px;">No</th>
        <th style="border:1px solid #ccc;padding:8px;">単語No.</th>
        <th style="border:1px solid #ccc;padding:8px;">問題</th>
        <th style="border:1px solid #ccc;padding:8px;">解答欄</th>
      </tr></thead>
      <tbody>${rows}</tbody></table>`;
    document.body.appendChild(wrap);
    try {
      await YNQ.exportTableAsPdf(wrap.querySelector("table"), `${YNQ.currentBook.name} - テスト問題`, `${YNQ.currentBook.name}_テスト問題.pdf`);
    } catch (err) {
      console.error("[test:exportSettingsPdf]", err);
      YNQ.showToast("PDFの作成に失敗しました");
    } finally {
      document.body.removeChild(wrap);
    }
  }

  /* ============================================================
     ② テスト実施画面
     ============================================================ */
  function startTest() {
    updateCandidatePool();
    if (candidatePool.length === 0) { YNQ.showToast("対象となる単語がありません"); return; }
    settings = readSettings();
    const pool = shuffle(candidatePool.slice());
    queue = pool.slice(0, Math.min(settings.count, pool.length));
    if (queue.length < settings.count) {
      YNQ.showToast(`対象が${queue.length}件のみのため、${queue.length}問で出題します`);
    }
    beginRun();
  }

  // 「もう一度」「間違えたのみ」からも呼ばれる、実施画面の開始処理
  function beginRun() {
    currentIndex = 0;
    answers = [];
    showScreen("running");
    stopTimer();
    if (settings.timeLimitMode === "total") {
      document.getElementById("test-run-timer").hidden = false;
      startTimer(settings.timeLimitSeconds, handleTimeUpTotal);
    } else {
      document.getElementById("test-run-timer").hidden = (settings.timeLimitMode === "none");
    }
    renderQuestion();
  }

  function bindRunningEvents() {
    document.getElementById("btn-flashcard-reveal").addEventListener("click", () => {
      document.getElementById("btn-flashcard-reveal").hidden = true;
      document.getElementById("flashcard-answer").hidden = false;
      document.getElementById("flashcard-judge").hidden = false;
    });
    document.getElementById("btn-flashcard-correct").addEventListener("click", () => {
      if (questionAnswered) return;
      submitAnswer(true, firstAlt(currentWord[currentAnswerField]));
    });
    document.getElementById("btn-flashcard-wrong").addEventListener("click", () => {
      if (questionAnswered) return;
      submitAnswer(false, "(不正解と自己申告)");
    });

    document.getElementById("btn-typed-submit").addEventListener("click", submitTyped);
    document.getElementById("typed-answer-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitTyped();
    });

    document.getElementById("btn-test-next").addEventListener("click", goToNextQuestion);

    document.getElementById("btn-test-abort").addEventListener("click", () => YNQ.openModal("modal-test-abort"));
    document.getElementById("btn-abort-cancel").addEventListener("click", () => YNQ.closeModal("modal-test-abort"));
    document.getElementById("btn-abort-ok").addEventListener("click", () => {
      YNQ.closeModal("modal-test-abort");
      stopTimer();
      showScreen("settings");
      YNQ.showToast("テストを中断しました(記録されていません)");
    });
  }

  function renderQuestion() {
    questionAnswered = false;
    currentWord = queue[currentIndex];
    const total = queue.length;

    document.getElementById("test-run-progress-text").textContent = `${currentIndex + 1} / ${total}問`;
    document.getElementById("test-run-progress-fill").style.width = `${(currentIndex / total) * 100}%`;

    document.getElementById("test-question-no").textContent = `No.${YNQ.pad4(currentWord.no)}`;
    const levelEl = document.getElementById("test-question-level");
    if (settings.showLevel) {
      const lv = currentWord.level || 0;
      levelEl.hidden = false;
      levelEl.textContent = lv;
      levelEl.style.background = YNQ.LEVEL_COLORS[lv];
    } else {
      levelEl.hidden = true;
    }

    const promptField = settings.direction === "word2meaning" ? "word" : "meaning";
    currentAnswerField = settings.direction === "word2meaning" ? "meaning" : "word";
    document.getElementById("test-question-prompt").textContent = firstAlt(currentWord[promptField]);

    document.getElementById("test-feedback").hidden = true;
    ["test-area-flashcard", "test-area-choice4", "test-area-typed"].forEach(id => document.getElementById(id).hidden = true);

    if (settings.format === "flashcard") renderFlashcard();
    else if (settings.format === "choice4") renderChoice4();
    else renderTyped();

    if (settings.timeLimitMode === "perQuestion") {
      startTimer(settings.timeLimitSeconds, handleTimeUpPerQuestion);
    }
  }

  function renderFlashcard() {
    document.getElementById("test-area-flashcard").hidden = false;
    document.getElementById("btn-flashcard-reveal").hidden = false;
    document.getElementById("flashcard-answer").hidden = true;
    document.getElementById("flashcard-judge").hidden = true;
    document.getElementById("flashcard-answer").textContent = firstAlt(currentWord[currentAnswerField]);
  }

  function renderChoice4() {
    const area = document.getElementById("test-area-choice4");
    area.hidden = false;
    const grid = document.getElementById("choice4-grid");

    const correctText = firstAlt(currentWord[currentAnswerField]);
    const distractorPool = shuffle(allWords.filter(x => x.id !== currentWord.id));
    const distractors = distractorPool.slice(0, 3).map(x => ({ id: x.id, text: firstAlt(x[currentAnswerField]) }));
    const options = shuffle([{ id: currentWord.id, text: correctText }, ...distractors]);

    grid.innerHTML = options.map(o => `<button type="button" class="btn btn-secondary choice-btn" data-id="${o.id}">${YNQ.escapeHtml(o.text)}</button>`).join("")
      + `<button type="button" class="btn btn-secondary choice-btn choice-dontknow" data-id="__unknown">わからない</button>`;

    grid.querySelectorAll(".choice-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (questionAnswered) return;
        const isCorrect = btn.dataset.id === currentWord.id;
        grid.querySelectorAll(".choice-btn").forEach(b => {
          b.disabled = true;
          if (b.dataset.id === currentWord.id) b.classList.add("correct");
          else if (b === btn && !isCorrect) b.classList.add("incorrect");
        });
        submitAnswer(isCorrect, btn.dataset.id === "__unknown" ? "わからない" : btn.textContent);
      });
    });
  }

  function renderTyped() {
    document.getElementById("test-area-typed").hidden = false;
    const input = document.getElementById("typed-answer-input");
    input.value = "";
    input.disabled = false;
    input.focus();
  }

  function submitTyped() {
    if (questionAnswered) return;
    const input = document.getElementById("typed-answer-input");
    const raw = input.value.trim();
    input.disabled = true;
    // 厳密採点: 複数正答(|区切り)のいずれかに大文字小文字・スペースまで完全一致するか
    const isCorrect = allAlts(currentWord[currentAnswerField]).includes(raw);
    submitAnswer(isCorrect, raw || "(未入力)");
  }

  function submitAnswer(isCorrect, userAnswerDisplay) {
    if (questionAnswered) return;
    questionAnswered = true;
    if (settings.timeLimitMode === "perQuestion") stopTimer();

    const levelBefore = currentWord.level || 0;
    const levelAfter = settings.levelScoring ? nextLevel(levelBefore, isCorrect) : levelBefore;

    answers.push({
      wordId: currentWord.id,
      no: currentWord.no,
      prompt: document.getElementById("test-question-prompt").textContent,
      correctAnswer: firstAlt(currentWord[currentAnswerField]),
      userAnswer: userAnswerDisplay,
      isCorrect, levelBefore, levelAfter
    });

    if (settings.scoringTiming === "each") {
      showFeedback(isCorrect);
    } else {
      goToNextQuestion();
    }
  }

  // Level採点(仕様#66): 正解ほど数値を下げ(1が下限)、不正解ほど数値を上げる(5が上限)。
  // 仕様#41により0(未実施)へは戻さない。
  function nextLevel(current, isCorrect) {
    const cur = current || 0;
    if (isCorrect) return cur <= 1 ? 1 : cur - 1;
    return cur === 0 ? 1 : Math.min(5, cur + 1);
  }

  function showFeedback(isCorrect) {
    const fb = document.getElementById("test-feedback");
    fb.hidden = false;
    document.getElementById("test-feedback-result").innerHTML = isCorrect
      ? `<span class="test-feedback-correct"><i class="fa-solid fa-circle-check"></i> 正解!</span>`
      : `<span class="test-feedback-incorrect"><i class="fa-solid fa-circle-xmark"></i> 不正解</span>`;
    const last = answers[answers.length - 1];
    document.getElementById("test-feedback-answer").textContent = isCorrect ? "" : `正解: ${last.correctAnswer}`;
  }

  function goToNextQuestion() {
    currentIndex++;
    if (currentIndex >= queue.length) finishTest();
    else renderQuestion();
  }

  /* ---------- タイマー ---------- */
  function startTimer(seconds, onExpire) {
    stopTimer();
    timer.remaining = seconds;
    updateTimerDisplay();
    timer.intervalId = setInterval(() => {
      timer.remaining--;
      updateTimerDisplay();
      if (timer.remaining <= 0) {
        stopTimer();
        onExpire();
      }
    }, 1000);
  }
  function stopTimer() {
    if (timer.intervalId) { clearInterval(timer.intervalId); timer.intervalId = null; }
  }
  function updateTimerDisplay() {
    const el = document.getElementById("test-run-timer");
    const text = document.getElementById("test-run-timer-text");
    if (!el || !text) return;
    const remaining = Math.max(0, timer.remaining);
    text.textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
    el.classList.toggle("timer-warning", remaining <= 10);
  }
  function handleTimeUpPerQuestion() {
    if (questionAnswered) return;
    submitAnswer(false, "(時間切れ)");
  }
  function handleTimeUpTotal() {
    YNQ.showToast("制限時間になりました");
    finishTest();
  }

  /* ============================================================
     ③ 結果画面
     ============================================================ */
  async function finishTest() {
    stopTimer();
    showScreen("result");
    await persistResults();
    renderResults();
  }

  async function persistResults() {
    const total = answers.length;
    const correctCount = answers.filter(a => a.isCorrect).length;
    try {
      if (settings.levelScoring && total > 0) {
        const batch = YNQ.db.batch();
        const today = todayFormatted();
        answers.forEach(a => {
          if (a.levelAfter !== a.levelBefore) {
            batch.update(wordsRef().doc(a.wordId), { level: a.levelAfter, lastTestDate: today, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          }
        });
        await batch.commit();
        answers.forEach(a => {
          const w = allWords.find(x => x.id === a.wordId);
          if (w) { w.level = a.levelAfter; w.lastTestDate = today; }
        });
      }

      // テスト実施記録を保存(将来のアカウントタブでの履歴表示用)
      await YNQ.db.collection("users").doc(YNQ.currentUser.uid).collection("testResults").add({
        folderId: YNQ.currentFolder.id, folderName: YNQ.currentFolder.name,
        bookId: YNQ.currentBook.id, bookName: YNQ.currentBook.name,
        total, correctCount,
        accuracyPct: total > 0 ? Math.round((correctCount / total) * 1000) / 10 : 0,
        format: settings.format, direction: settings.direction,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      console.error("[test:persistResults]", err);
      YNQ.showToast("結果の保存に失敗しました(表示は継続します)");
    }
  }

  function renderResults() {
    const total = answers.length;
    const correctCount = answers.filter(a => a.isCorrect).length;
    const pct = total > 0 ? Math.round((correctCount / total) * 1000) / 10 : 0;
    document.getElementById("test-result-score").innerHTML = `${pct}%<small>${correctCount} / ${total} 問正解</small>`;

    const tbody = document.getElementById("test-result-body");
    tbody.innerHTML = answers.map((a, idx) => `
      <tr>
        <td>${YNQ.pad4(a.no)}</td>
        <td class="col-word">${YNQ.escapeHtml(a.prompt)}</td>
        <td class="col-meaning">${YNQ.escapeHtml(a.userAnswer)}</td>
        <td class="col-meaning">${YNQ.escapeHtml(a.correctAnswer)}</td>
        <td>${a.isCorrect ? '<span class="judge-badge judge-correct">正解</span>' : '<span class="judge-badge judge-incorrect">不正解</span>'}</td>
        <td>
          <span class="level-pill" style="background:${YNQ.LEVEL_COLORS[a.levelBefore]};cursor:default;">${a.levelBefore}</span>
          <i class="fa-solid fa-arrow-right" style="margin:0 4px;color:var(--color-text-muted);"></i>
          <button type="button" class="level-pill" style="background:${YNQ.LEVEL_COLORS[a.levelAfter]};" data-action="edit-level" data-idx="${idx}">${a.levelAfter}</button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll('[data-action="edit-level"]').forEach(btn => {
      btn.addEventListener("click", (e) => openResultLevelPicker(e, Number(btn.dataset.idx)));
    });
  }

  function openResultLevelPicker(e, idx) {
    e.stopPropagation();
    const pop = document.getElementById("level-picker-popover");
    const rect = e.currentTarget.getBoundingClientRect();
    pop.innerHTML = [1, 2, 3, 4, 5].map(lv => `<button type="button" class="level-pill" style="background:${YNQ.LEVEL_COLORS[lv]}" data-set-level="${lv}">${lv}</button>`).join("");
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
    pop.hidden = false;
    pop.querySelectorAll("[data-set-level]").forEach(btn => {
      btn.addEventListener("click", async () => {
        pop.hidden = true;
        const lv = Number(btn.dataset.setLevel);
        const a = answers[idx];
        a.levelAfter = lv;
        try {
          await wordsRef().doc(a.wordId).update({ level: lv, lastTestDate: todayFormatted(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          const w = allWords.find(x => x.id === a.wordId);
          if (w) { w.level = lv; w.lastTestDate = todayFormatted(); }
          renderResults();
        } catch (err) {
          console.error("[test:openResultLevelPicker]", err);
          YNQ.showToast("更新に失敗しました");
        }
      });
    });
  }

  function bindResultEvents() {
    document.getElementById("btn-result-finish").addEventListener("click", () => {
      showScreen("settings");
      updateCandidatePool();
    });
    document.getElementById("btn-result-retry").addEventListener("click", beginRun);
    document.getElementById("btn-result-retry-wrong").addEventListener("click", () => {
      const wrongIds = new Set(answers.filter(a => !a.isCorrect).map(a => a.wordId));
      if (wrongIds.size === 0) { YNQ.showToast("間違えた問題はありません"); return; }
      queue = allWords.filter(w => wrongIds.has(w.id));
      shuffle(queue);
      beginRun();
    });
    document.getElementById("btn-result-export-pdf").addEventListener("click", exportResultPdf);

    // ポップオーバーの外側クリックで閉じる(単語一覧タブ側と共通の要素のため、未登録でもここで保証する)
    document.addEventListener("click", (e) => {
      const pop = document.getElementById("level-picker-popover");
      if (pop && !pop.hidden && !pop.contains(e.target) && e.target.dataset.action !== "level" && e.target.dataset.action !== "edit-level") {
        pop.hidden = true;
      }
    });
  }

  async function exportResultPdf() {
    if (answers.length === 0) { YNQ.showToast("出力できる結果がありません"); return; }
    const table = document.querySelector("#test-screen-result .table-scroll table");
    try {
      await YNQ.exportTableAsPdf(table, `${YNQ.currentBook.name} - テスト結果`, `${YNQ.currentBook.name}_テスト結果.pdf`);
    } catch (err) {
      console.error("[test:exportResultPdf]", err);
      YNQ.showToast("PDFの作成に失敗しました");
    }
  }

  return { init };
})();
