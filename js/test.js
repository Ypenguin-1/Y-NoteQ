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
  let lastTestPoints = null; // 直近のテストで獲得したランクポイント(仕様追加2026/09/12 No.4)。ランクなしの間はnull

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
  // 仕様追加2026/09/13 No.1-4: 出題順序(ランダム/昇順/降順)に応じて並び替える
  function orderPool(arr, order) {
    if (order === "asc") return arr.sort((a, b) => a.no - b.no);
    if (order === "desc") return arr.sort((a, b) => b.no - a.no);
    return shuffle(arr);
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
    YNQ.bindLevelToggleGroup("test-set-levels", false, updateCandidatePool); // 仕様修正2026/09/12 #2: 各Level自身の色で表示
    bindToggleGroup("test-set-order", true); // 仕様追加2026/09/13 No.1-4: 出題順序
    bindToggleGroup("test-set-format", true);
    bindToggleGroup("test-set-show-level", true);
    bindToggleGroup("test-set-level-scoring", true);
    bindToggleGroup("test-set-timelimit-mode", true, () => {
      document.getElementById("test-set-timelimit-seconds-wrap").hidden = (getToggleValue("test-set-timelimit-mode") === "none");
    });

    document.getElementById("test-set-no").addEventListener("input", updateCandidatePool);
    document.getElementById("btn-test-start").addEventListener("click", startTest);
  }

  function readSettings() {
    return {
      count: Math.max(1, parseInt(document.getElementById("test-set-count").value, 10) || 1),
      direction: getToggleValue("test-set-direction"),
      scoringTiming: getToggleValue("test-set-scoring-timing"),
      order: getToggleValue("test-set-order") || "random", // 仕様追加2026/09/13 No.1-4
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

  // 「問題+解答欄」だけの印刷用PDFを作る共通処理(仕様修正2026/09/12 No.6, No.2-4)。
  // テスト実施中(running画面)からのみ呼び出され、実際にそのテストで出題された queue を
  // そのまま使うことで「今受けているテストと同じ内容」のPDFになるようにする。
  async function exportBlankTestPdf(pool, direction) {
    if (pool.length === 0) { YNQ.showToast("出力できる単語がありません"); return; }
    const promptField = direction === "word2meaning" ? "word" : "meaning";

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
      console.error("[test:exportBlankTestPdf]", err);
      YNQ.showToast("PDFの作成に失敗しました");
    } finally {
      document.body.removeChild(wrap);
    }
  }

  // 実施画面(テスト中): 今回実際に出題された queue をそのままPDF化(仕様修正2026/09/12 No.2-4)
  async function exportCurrentTestPdf() {
    if (!settings || queue.length === 0) { YNQ.showToast("出力できるテストがありません"); return; }
    await exportBlankTestPdf(queue, settings.direction);
  }

  /* ============================================================
     ② テスト実施画面
     ============================================================ */
  function startTest() {
    updateCandidatePool();
    if (candidatePool.length === 0) { YNQ.showToast("対象となる単語がありません"); return; }
    settings = readSettings();
    const pool = orderPool(candidatePool.slice(), settings.order); // 仕様追加2026/09/13 No.1-4
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

    document.getElementById("btn-test-export-pdf-running").addEventListener("click", exportCurrentTestPdf);

    // 仕様追加2026/09/12 No.1: 出題文の読み上げ(出題が単語なら英語、意味なら日本語として読む)
    document.getElementById("btn-speak-question").addEventListener("click", () => {
      const text = document.getElementById("test-question-prompt").textContent;
      const lang = settings.direction === "word2meaning" ? "en-US" : "ja-JP";
      YNQ.speakText(text, lang);
    });

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
    const streakBefore = currentWord.correctStreak || 0;
    const update = settings.levelScoring
      ? computeLevelUpdate(levelBefore, streakBefore, isCorrect)
      : { level: levelBefore, streak: streakBefore };
    const levelAfter = update.level;
    currentWord.correctStreak = update.streak; // 同じ単語帳内で同じ単語が連続出題される場合に備えてローカルにも反映

    answers.push({
      wordId: currentWord.id,
      no: currentWord.no,
      prompt: document.getElementById("test-question-prompt").textContent,
      correctAnswer: firstAlt(currentWord[currentAnswerField]),
      userAnswer: userAnswerDisplay,
      isCorrect, levelBefore, levelAfter, streakAfter: update.streak,
      prevLastTestDate: currentWord.lastTestDate || null // 仕様追加2026/09/12 No.4-P: 更新される前の実施日(ランクポイント計算用)
    });

    if (settings.scoringTiming === "each") {
      // 仕様追加2026/09/12 No.2: 毎時採点モードのみ、正解/不正解の効果音を鳴らす
      // (最後に採点モードでは正誤を都度知らせないため、ここでは鳴らさない)
      if (isCorrect) YNQ.playCorrectSound(); else YNQ.playIncorrectSound();
      showFeedback(isCorrect);
    } else {
      goToNextQuestion();
    }
  }

  // Level採点(仕様修正2026/09/12 #1):
  // ・不正解は即座にLevelを+1(5が上限)。
  // ・正解は2回連続して初めてLevelを-1(1が下限)。1回だけの正解では変動せず、
  //   「あと1回正解でLevel down」という連続正解カウントだけを進める。
  // ・Level1はこれ以上下げる必要がないため、連続カウント不要でそのまま1を維持する(仕様#1)。
  // ・仕様#41により0(未実施)へは戻さない。0からの初回正解はLevel1への移行として扱う。
  function computeLevelUpdate(current, streak, isCorrect) {
    const cur = current || 0;
    if (!isCorrect) {
      return { level: cur === 0 ? 1 : Math.min(5, cur + 1), streak: 0 };
    }
    if (cur <= 1) {
      return { level: 1, streak: 0 };
    }
    const newStreak = (streak || 0) + 1;
    if (newStreak >= 2) {
      return { level: cur - 1, streak: 0 };
    }
    return { level: cur, streak: newStreak };
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
    YNQ.playResultSound(); // 仕様追加2026/09/12 No.2: 結果画面へ遷移した時に効果音を鳴らす
    await persistResults();
    renderResults();
  }

  async function persistResults() {
    const total = answers.length;
    const correctCount = answers.filter(a => a.isCorrect).length;
    lastTestPoints = null;
    try {
      if (settings.levelScoring && total > 0) {
        const batch = YNQ.db.batch();
        const today = todayFormatted();
        // Levelが変わらなくても、次回1回正解でLevel downする「連続正解カウント」自体は
        // 毎回保存する必要があるため、回答したすべての単語を書き込み対象にする
        answers.forEach(a => {
          const w = allWords.find(x => x.id === a.wordId);
          // 初見日はLevel0→1になった時だけ記録し、それ以外の遷移では変更しない(仕様修正2026/09/12 No.5-8)
          const dateFields = YNQ.buildTestDateFields(a.levelBefore, w && w.firstSeenDate, today);
          batch.update(wordsRef().doc(a.wordId), {
            level: a.levelAfter,
            correctStreak: a.streakAfter || 0,
            ...dateFields,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        answers.forEach(a => {
          const w = allWords.find(x => x.id === a.wordId);
          if (w) {
            w.level = a.levelAfter; w.correctStreak = a.streakAfter || 0; w.lastTestDate = today;
            // 初見日はLevel0→1になった時だけ(仕様修正2026/09/12 No.5-8)
            if ((a.levelBefore || 0) === 0 && !w.firstSeenDate) w.firstSeenDate = today;
          }
        });
      }

      // 仕様追加2026/09/12 No.4: ランクポイントの計算・付与(単語カードでは仕様Eのみ、それ以外は仕様H〜Pも対象)
      const pointsResult = await applyRankProgressForTest();
      lastTestPoints = pointsResult; // ランクなしの場合はnullのまま(結果画面では表示しない)

      // テスト実施記録を保存(将来のアカウントタブでの履歴表示用)
      await YNQ.db.collection("users").doc(YNQ.currentUser.uid).collection("testResults").add({
        folderId: YNQ.currentFolder.id, folderName: YNQ.currentFolder.name,
        bookId: YNQ.currentBook.id, bookName: YNQ.currentBook.name,
        total, correctCount,
        accuracyPct: total > 0 ? Math.round((correctCount / total) * 1000) / 10 : 0,
        format: settings.format, direction: settings.direction,
        pointsEarned: pointsResult ? pointsResult.total : null, // 仕様S: ポイント履歴もテスト実施記録から見られるように
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      console.error("[test:persistResults]", err);
      YNQ.showToast("結果の保存に失敗しました(表示は継続します)");
    }
  }

  // 仕様追加2026/09/12 No.4-A,E〜P: ランクの進行(Unranked解除・ポイント加算・昇格/降格)をまとめて処理する。
  // 戻り値: ランクありの場合は { total, breakdown } のポイント内訳、Unrankedのままの場合は null。
  async function applyRankProgressForTest() {
    const userRef = YNQ.db.collection("users").doc(YNQ.currentUser.uid);
    const isQualifyingFormat = settings.format !== "flashcard"; // 仕様A・G: 単語カードは対象外

    try {
      const userDoc = await userRef.get();
      const data = userDoc.exists ? userDoc.data() : {};
      const rank = data.rank || { tier: "Unranked", division: null, points: 0, graceUsed: false };
      const today = todayFormatted();

      // 仕様A: Unrankedの間は、単語カード以外のテストを5回行ったらIron Iを付与する
      if (rank.tier === "Unranked") {
        if (!isQualifyingFormat) return null;
        const qualifyingTestCount = (data.qualifyingTestCount || 0) + 1;
        if (qualifyingTestCount >= 5) {
          const newRank = { tier: "Iron", division: 1, points: 0, graceUsed: false };
          await userRef.set({
            qualifyingTestCount,
            rank: newRank,
            peakRank: newRank,
            peakRankAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          await YNQ.logRankPromotionIfNeeded(userRef, rank, newRank); // 仕様R
          YNQ.showToast("Iron Ⅰ に昇格しました!");
        } else {
          await userRef.set({ qualifyingTestCount }, { merge: true });
        }
        return null; // 昇格したそのテスト自体はポイント付与の対象外(まだランク未確定だったため)
      }

      // すでにランクがある場合: ポイントを計算して加算する
      const pointsResult = YNQ_RANK.computeTestPoints({
        answers, format: settings.format, levelScoring: settings.levelScoring, today
      });
      const newRankState = YNQ_RANK.applyRankPointsDelta(rank, pointsResult.total);

      const updateData = { rank: newRankState };
      YNQ.maybeUpdatePeakRank(updateData, data.peakRank, newRankState); // 仕様R: 履歴表示用
      await userRef.set(updateData, { merge: true });
      await YNQ.logRankPromotionIfNeeded(userRef, rank, newRankState); // 仕様R: 昇格を履歴に記録
      // 仕様追加2026/09/13 No.3-3: 結果画面でランク/ポイント推移をアニメーション表示するため、
      // テスト前後のランク状態も一緒に返す
      return { ...pointsResult, rankBefore: rank, rankAfter: newRankState };
    } catch (err) {
      console.error("[test:applyRankProgressForTest]", err);
      return null; // ランク更新に失敗してもテスト結果自体の表示は継続する
    }
  }

  // ポイントを常に小数第1位までの表記にする(仕様修正2026/09/12 No.5-5)
  function formatPt(n) {
    return `${n >= 0 ? "+" : ""}${n.toFixed(1)}pt`;
  }

  // 仕様修正2026/09/13 No.3-4: 獲得ポイントの内訳を「初見の単語に触れた」「Levelの維持」
  // 「Levelの推移」「ボーナス」の4項目に再構成し、一番下に合計行(ひっ算のように)を表示する。
  // 項目(ラベル)は左寄せ、計算(pt)は右寄せ。
  const POINTS_WORD_CATEGORY_LABELS = {
    level0Touch: "初見の単語に触れた",
    levelMaintain: "Levelの維持",
    levelChange: "Levelの推移"
  };
  // 「〇pt × ▢単語 = △pt」形式の行を作る(単価が複数種類あれば複数行になる)
  function formatCategoryLines(cat) {
    if (!cat || !cat.items || cat.items.length === 0) {
      return `<div class="points-breakdown-line"><span>該当なし</span><strong>${formatPt(0)}</strong></div>`;
    }
    return cat.items.map(it => {
      const lineTotal = YNQ_RANK.roundPt(it.unit * it.count);
      return `<div class="points-breakdown-line"><span>${formatPt(it.unit)} × ${it.count}単語</span><strong>= ${formatPt(lineTotal)}</strong></div>`;
    }).join("");
  }
  function renderPointsBreakdown() {
    const btn = document.getElementById("btn-toggle-points-breakdown");
    const panel = document.getElementById("points-breakdown");
    if (!lastTestPoints) {
      btn.hidden = true;
      panel.hidden = true;
      return;
    }
    btn.hidden = false;

    const b = lastTestPoints.breakdown;
    const wordCatsHtml = Object.keys(POINTS_WORD_CATEGORY_LABELS).map(key => `
      <div class="points-breakdown-cat">
        <div class="points-breakdown-cat-title">${POINTS_WORD_CATEGORY_LABELS[key]}</div>
        ${formatCategoryLines(b[key])}
      </div>
    `).join("");

    const bonusRows = [
      { label: "出題数ボーナス", value: formatPt(b.tenQuestionBonus.total) },
      { label: "正答率ボーナス/ペナルティ", value: formatPt(b.accuracyBonus.total) },
      { label: "復習ボーナス", value: formatPt(b.recentTouchBonus.total) }
    ];
    if (lastTestPoints.formatMultiplierApplied) {
      bonusRows.push({
        label: "形式ボーナス",
        value: `${formatPt(lastTestPoints.subtotal)} × 1.2 = ${formatPt(lastTestPoints.total)}`
      });
    }
    const bonusHtml = `
      <div class="points-breakdown-cat">
        <div class="points-breakdown-cat-title">ボーナス</div>
        ${bonusRows.map(r => `<div class="points-breakdown-line"><span>${r.label}</span><strong>${r.value}</strong></div>`).join("")}
      </div>
    `;

    panel.innerHTML = `
      ${wordCatsHtml}
      ${bonusHtml}
      <div class="points-breakdown-total"><span>合計</span><strong>${formatPt(lastTestPoints.total)}</strong></div>
    `;
  }

  // 仕様追加2026/09/13 No.3-3: 結果画面にランク/ポイント推移をアニメーション付きで表示する
  function animateNumber(el, from, to, duration, formatFn) {
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = formatFn(from + (to - from) * t);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function renderRankProgress() {
    const wrap = document.getElementById("test-result-rank");
    if (!lastTestPoints || !lastTestPoints.rankAfter) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const badgeImg = document.getElementById("test-result-rank-badge");
    const nameEl = document.getElementById("test-result-rank-name");
    const fillEl = document.getElementById("test-result-rank-fill");
    const ptsEl = document.getElementById("test-result-rank-points");

    const before = lastTestPoints.rankBefore;
    const after = lastTestPoints.rankAfter;
    const beforeIdx = YNQ_RANK.findStepIndex(before.tier, before.division);
    const afterIdx = YNQ_RANK.findStepIndex(after.tier, after.division);
    const promoted = afterIdx > beforeIdx;
    const demoted = afterIdx < beforeIdx;

    function pctFor(pts, max) { return max === null ? 100 : Math.max(0, Math.min(100, (pts / max) * 100)); }
    function ptsLabel(rank) {
      const max = YNQ_RANK.tierMaxPoints(rank.tier);
      return max === null ? `${rank.points.toFixed(1)}pt(上限なし)` : `${rank.points.toFixed(1)} / ${max}pt`;
    }

    // 初期表示(テスト前の状態)
    badgeImg.src = YNQ_RANK.rankBadgeImagePath(before);
    badgeImg.classList.remove("test-result-rank-badge-pop");
    nameEl.textContent = YNQ_RANK.rankLabel(before);
    ptsEl.textContent = ptsLabel(before);
    fillEl.style.transition = "none";
    fillEl.style.width = `${pctFor(before.points, YNQ_RANK.tierMaxPoints(before.tier))}%`;
    void fillEl.offsetWidth; // 強制リフロー(このあとのtransitionを効かせるため)

    if (!promoted && !demoted) {
      // 段階が変わらない場合: そのままバー・ポイントをアニメーションさせる
      fillEl.style.transition = "width .6s ease";
      requestAnimationFrame(() => {
        fillEl.style.width = `${pctFor(after.points, YNQ_RANK.tierMaxPoints(after.tier))}%`;
      });
      animateNumber(ptsEl, before.points, after.points, 600, (v) => {
        const max = YNQ_RANK.tierMaxPoints(after.tier);
        return max === null ? `${v.toFixed(1)}pt(上限なし)` : `${v.toFixed(1)} / ${max}pt`;
      });
    } else {
      // 段階が変わる場合: 今の段階を満タン(0%)まで満たしてから、バッジを差し替えて
      // 新しい段階を0%(満タン)から実際のptまで満たす2段階アニメーションにする
      fillEl.style.transition = "width .5s ease";
      requestAnimationFrame(() => { fillEl.style.width = promoted ? "100%" : "0%"; });

      setTimeout(() => {
        badgeImg.src = YNQ_RANK.rankBadgeImagePath(after);
        badgeImg.classList.add("test-result-rank-badge-pop");
        nameEl.innerHTML = `${YNQ.escapeHtml(YNQ_RANK.rankLabel(after))}` +
          `<span class="test-result-rank-change${demoted ? " is-demoted" : ""}">${promoted ? "昇格!" : "降格"}</span>`;

        fillEl.style.transition = "none";
        fillEl.style.width = promoted ? "0%" : "100%";
        void fillEl.offsetWidth;
        fillEl.style.transition = "width .5s ease";
        requestAnimationFrame(() => {
          fillEl.style.width = `${pctFor(after.points, YNQ_RANK.tierMaxPoints(after.tier))}%`;
        });
      }, 550);
      animateNumber(ptsEl, before.points, after.points, 1100, (v) => `${v.toFixed(1)}pt`);
    }
  }

  function renderResults() {
    const total = answers.length;
    const correctCount = answers.filter(a => a.isCorrect).length;
    const pct = total > 0 ? Math.round((correctCount / total) * 1000) / 10 : 0;
    // 仕様追加2026/09/12 No.4-G: 獲得ポイントを表示(ランクなしの間は表示しない)
    const pointsHtml = lastTestPoints ? `<small>獲得ポイント: ${formatPt(lastTestPoints.total)}</small>` : "";
    document.getElementById("test-result-score").innerHTML = `${pct}%<small>${correctCount} / ${total} 問正解</small>${pointsHtml}`;
    renderRankProgress(); // 仕様追加2026/09/13 No.3-3
    renderPointsBreakdown(); // 仕様追加2026/09/12 No.5-4

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
        a.streakAfter = 0; // 手動修正のため、連続正解カウントはリセットする
        try {
          const w = allWords.find(x => x.id === a.wordId);
          // 初見日はLevel0→1になった時だけ(仕様修正2026/09/12 No.5-8)。ここでは元々の(テスト前の)
          // levelBeforeを基準に判定する(手動修正はそのテストの結果を訂正しているだけのため)
          const dateFields = YNQ.buildTestDateFields(a.levelBefore, w && w.firstSeenDate, todayFormatted());
          await wordsRef().doc(a.wordId).update({
            level: lv, correctStreak: 0, ...dateFields,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          if (w) { w.level = lv; w.correctStreak = 0; Object.assign(w, dateFields); }
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

    // 仕様追加2026/09/12 No.5-4: ポイント内訳の開閉
    document.getElementById("btn-toggle-points-breakdown").addEventListener("click", (e) => {
      const panel = document.getElementById("points-breakdown");
      panel.hidden = !panel.hidden;
      e.currentTarget.innerHTML = panel.hidden
        ? 'ポイントの内訳を見る <i class="fa-solid fa-chevron-down"></i>'
        : '閉じる <i class="fa-solid fa-chevron-up"></i>';
    });

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
