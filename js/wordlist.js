/* ============================================================
   Y-NoteQ wordlist.js
   「単語一覧」タブ(tabs/wordlist.html)の描画とデータ操作
   ・アナリティクス(Level別グラフ)
   ・検索フィルター(単語No/単語/意味/暗記度/実施日)
   ・単語表(暗記度タップで変更・詳細・リセット)
   ・CSV / PDF ダウンロード
   ============================================================ */
window.WordlistTab = (function () {

  const LEVELS_ALL = [0, 1, 2, 3, 4, 5];
  let allWords = [];            // 現在開いている単語帳の全単語(Firestoreから取得したもの)
  let displayedWords = [];      // 検索フィルター適用後、現在テーブルに表示している単語(CSV/PDF出力対象)
  let selectedLevelChips = new Set(); // 検索フィルターの暗記度チップ選択状態(空=すべて)

  function wordsRef() {
    return YNQ.wordsCol(YNQ.currentFolder.id, YNQ.currentBook.id);
  }

  /* ---------- 初期表示 ---------- */
  function init() {
    const hasBook = !!(YNQ.currentFolder && YNQ.currentBook);
    document.getElementById("wordlist-empty").hidden = hasBook;
    document.getElementById("wordlist-content").hidden = !hasBook;
    if (!hasBook) {
      document.getElementById("btn-goto-folders").addEventListener("click", () => YNQ.loadTab("home"));
      return;
    }

    selectedLevelChips = new Set();
    renderLevelChips();
    bindEvents();
    loadWords();
  }

  async function loadWords() {
    const tbody = document.getElementById("word-table-body");
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted);padding:30px;">読み込み中...</td></tr>`;
    try {
      const snap = await wordsRef().orderBy("no", "asc").get();
      allWords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAnalytics();
      applyFilters();
    } catch (err) {
      console.error("[wordlist:loadWords]", err);
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-danger);padding:30px;">読み込みに失敗しました: ${YNQ.escapeHtml(err.message)}</td></tr>`;
    }
  }

  function bindEvents() {
    document.getElementById("analytics-range-from").addEventListener("input", renderAnalytics);
    document.getElementById("analytics-range-to").addEventListener("input", renderAnalytics);
    document.getElementById("analytics-exclude-notdone").addEventListener("change", renderAnalytics);

    ["filter-no", "filter-word", "filter-meaning", "filter-date"].forEach(id => {
      document.getElementById(id).addEventListener("input", applyFilters);
    });
    document.getElementById("btn-filter-clear").addEventListener("click", () => {
      document.getElementById("filter-no").value = "";
      document.getElementById("filter-word").value = "";
      document.getElementById("filter-meaning").value = "";
      document.getElementById("filter-date").value = "";
      selectedLevelChips.clear();
      renderLevelChips();
      applyFilters();
    });

    document.getElementById("btn-export-csv").addEventListener("click", exportCsv);
    document.getElementById("btn-export-pdf").addEventListener("click", exportPdf);
    document.getElementById("btn-close-word-detail").addEventListener("click", () => YNQ.closeModal("modal-word-detail"));

    // ポップオーバー/詳細モーダルの外側クリックで閉じる
    document.addEventListener("click", (e) => {
      const pop = document.getElementById("level-picker-popover");
      if (!pop.hidden && !pop.contains(e.target) && e.target.dataset.action !== "level") {
        pop.hidden = true;
      }
    });
  }

  /* ---------- アナリティクス ---------- */
  function renderAnalytics() {
    const fromVal = parseInt(document.getElementById("analytics-range-from").value, 10);
    const toVal = parseInt(document.getElementById("analytics-range-to").value, 10);
    const excludeNotDone = document.getElementById("analytics-exclude-notdone").checked;

    const scoped = allWords.filter(w => {
      if (!isNaN(fromVal) && w.no < fromVal) return false;
      if (!isNaN(toVal) && w.no > toVal) return false;
      return true;
    });

    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    scoped.forEach(w => { const lv = w.level || 0; counts[lv] = (counts[lv] || 0) + 1; });

    // 仕様#45: 常にLevel 1,2,3,4,5,0の順。「未実施を除く」ON時はLevel0を除外し1〜5で100%にする
    const order = excludeNotDone ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 0];
    const total = excludeNotDone ? scoped.length - counts[0] : scoped.length;

    const bar = document.getElementById("analytics-bar");
    const legend = document.getElementById("analytics-legend");

    if (total <= 0) {
      bar.innerHTML = "";
      legend.innerHTML = `<div class="analytics-legend-item">対象の単語がありません</div>`;
      return;
    }

    bar.innerHTML = order.map(lv => {
      const pct = (counts[lv] / total) * 100;
      if (pct <= 0) return "";
      return `<div class="analytics-bar-seg" style="width:${pct}%;background:${YNQ.LEVEL_COLORS[lv]}" title="Level${lv}: ${pct.toFixed(1)}%"></div>`;
    }).join("");

    legend.innerHTML = order.map(lv => {
      const pct = (counts[lv] / total) * 100;
      return `
        <div class="analytics-legend-item">
          <span class="legend-dot" style="background:${YNQ.LEVEL_COLORS[lv]}"></span>
          Level${lv}: ${pct.toFixed(1)}% | ${counts[lv]}単語
        </div>`;
    }).join("");
  }

  /* ---------- 検索フィルター ---------- */
  function renderLevelChips() {
    const wrap = document.getElementById("filter-level-chips");
    wrap.innerHTML = LEVELS_ALL.map(lv => `
      <button type="button" class="btn ${selectedLevelChips.has(lv) ? "" : "btn-secondary"}"
              data-level="${lv}"
              style="${selectedLevelChips.has(lv) ? `background:${YNQ.LEVEL_COLORS[lv]};color:#1a1a1a;border-color:${YNQ.LEVEL_COLORS[lv]};` : ""}">
        ${lv === 0 ? "未実施" : "Level " + lv}
      </button>
    `).join("");
    wrap.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        const lv = Number(btn.dataset.level);
        if (selectedLevelChips.has(lv)) selectedLevelChips.delete(lv); else selectedLevelChips.add(lv);
        renderLevelChips();
        applyFilters();
      });
    });
  }

  // "1-10" や "3,5,10" のような単語No指定を判定する関数を作る(仕様#49)
  function parseNoQuery(str) {
    if (!str) return null;
    const ranges = [];
    const singles = new Set();
    str.split(",").map(s => s.trim()).filter(Boolean).forEach(token => {
      const m = token.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) ranges.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
      else if (/^\d+$/.test(token)) singles.add(parseInt(token, 10));
    });
    return (no) => singles.has(no) || ranges.some(([a, b]) => no >= Math.min(a, b) && no <= Math.max(a, b));
  }

  function applyFilters() {
    const noPredicate = parseNoQuery(document.getElementById("filter-no").value.trim());
    const wordQ = document.getElementById("filter-word").value.trim();
    const meaningQ = document.getElementById("filter-meaning").value.trim();
    const dateQ = document.getElementById("filter-date").value; // "YYYY-MM-DD" or ""

    displayedWords = allWords.filter(w => {
      if (noPredicate && !noPredicate(w.no)) return false;
      if (wordQ && !(w.word || "").includes(wordQ)) return false;
      if (meaningQ && !(w.meaning || "").includes(meaningQ)) return false;
      if (selectedLevelChips.size > 0 && !selectedLevelChips.has(w.level || 0)) return false;
      if (dateQ) {
        const wDate = (w.lastTestDate || "").replace(/\//g, "-");
        if (wDate !== dateQ) return false;
      }
      return true;
    });
    renderTable();
  }

  /* ---------- 単語表 ---------- */
  function renderTable() {
    const tbody = document.getElementById("word-table-body");
    if (displayedWords.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted);padding:30px;">該当する単語がありません</td></tr>`;
      return;
    }
    tbody.innerHTML = displayedWords.map(w => {
      const level = w.level || 0;
      const dateCell = level === 0
        ? `<span class="badge-notdone">未実施</span>`
        : YNQ.escapeHtml(w.lastTestDate || "-");
      return `
        <tr data-id="${w.id}">
          <td>${YNQ.pad4(w.no)}</td>
          <td class="col-word">${YNQ.escapeHtml(w.word)}</td>
          <td class="col-meaning">${YNQ.escapeHtml(w.meaning)}</td>
          <td>${dateCell}</td>
          <td><button type="button" class="level-pill" style="background:${YNQ.LEVEL_COLORS[level]}" data-action="level" data-id="${w.id}">${level}</button></td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn btn-secondary" data-action="detail" data-id="${w.id}">詳細</button>
              <button type="button" class="btn btn-secondary" data-action="reset" data-id="${w.id}">リセット</button>
            </div>
          </td>
        </tr>`;
    }).join("");

    tbody.querySelectorAll('[data-action="level"]').forEach(btn => btn.addEventListener("click", (e) => openLevelPicker(e, btn.dataset.id)));
    tbody.querySelectorAll('[data-action="detail"]').forEach(btn => btn.addEventListener("click", () => openDetail(btn.dataset.id)));
    tbody.querySelectorAll('[data-action="reset"]').forEach(btn => btn.addEventListener("click", () => resetWord(btn.dataset.id)));
  }

  // 今日の日付を "2026/05/25" 形式で返す(仕様#53)
  function todayFormatted() {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }

  // 暗記度バッジをタップした時、Level 1〜5を選べるポップオーバーを出す(0への手動変更は不可=仕様#41)
  function openLevelPicker(e, wordId) {
    e.stopPropagation();
    const pop = document.getElementById("level-picker-popover");
    const rect = e.currentTarget.getBoundingClientRect();
    pop.innerHTML = [1, 2, 3, 4, 5].map(lv => `
      <button type="button" class="level-pill" style="background:${YNQ.LEVEL_COLORS[lv]}" data-set-level="${lv}">${lv}</button>
    `).join("");
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
    pop.hidden = false;
    pop.querySelectorAll("[data-set-level]").forEach(btn => {
      btn.addEventListener("click", () => {
        pop.hidden = true;
        setWordLevel(wordId, Number(btn.dataset.setLevel));
      });
    });
  }

  async function setWordLevel(wordId, level) {
    try {
      await wordsRef().doc(wordId).update({
        level,
        correctStreak: 0, // 手動変更のため、テストの連続正解カウントはリセットする
        lastTestDate: todayFormatted(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      const w = allWords.find(x => x.id === wordId);
      if (w) { w.level = level; w.correctStreak = 0; w.lastTestDate = todayFormatted(); }
      renderAnalytics();
      applyFilters();
    } catch (err) {
      console.error("[wordlist:setWordLevel]", err);
      YNQ.showToast("更新に失敗しました");
    }
  }

  function resetWord(wordId) {
    YNQ.confirmDialog("この単語の暗記度を「未実施」に戻しますか?", async () => {
      try {
        await wordsRef().doc(wordId).update({
          level: 0,
          correctStreak: 0,
          lastTestDate: firebase.firestore.FieldValue.delete(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const w = allWords.find(x => x.id === wordId);
        if (w) { w.level = 0; w.correctStreak = 0; w.lastTestDate = null; }
        renderAnalytics();
        applyFilters();
        YNQ.showToast("未実施に戻しました");
      } catch (err) {
        console.error("[wordlist:resetWord]", err);
        YNQ.showToast("リセットに失敗しました");
      }
    });
  }

  function openDetail(wordId) {
    const w = allWords.find(x => x.id === wordId);
    if (!w) return;
    const level = w.level || 0;
    document.getElementById("word-detail-body").innerHTML = `
      <div class="field"><label>単語No.</label><p>${YNQ.pad4(w.no)}</p></div>
      <div class="field"><label>単語</label><p>${YNQ.escapeHtml(w.word)}</p></div>
      <div class="field"><label>意味</label><p>${YNQ.escapeHtml(w.meaning)}</p></div>
      <div class="field"><label>暗記度</label><p><span class="level-pill" style="background:${YNQ.LEVEL_COLORS[level]};cursor:default;">${level}</span></p></div>
      <div class="field"><label>実施日</label><p>${level === 0 ? "未実施" : YNQ.escapeHtml(w.lastTestDate || "-")}</p></div>
    `;
    YNQ.openModal("modal-word-detail");
  }

  /* ---------- CSVダウンロード ---------- */
  function csvEscape(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    if (displayedWords.length === 0) { YNQ.showToast("出力できる単語がありません"); return; }
    const rows = [["単語No", "単語", "意味", "実施日", "暗記度"]];
    displayedWords.forEach(w => {
      const level = w.level || 0;
      rows.push([YNQ.pad4(w.no), w.word, w.meaning, level === 0 ? "未実施" : (w.lastTestDate || ""), level]);
    });
    // 先頭にBOMを付与し、Excelで開いた際の文字化けを防止
    const csv = "﻿" + rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `${YNQ.currentBook.name}_単語一覧.csv`);
  }

  /* ---------- PDFダウンロード ---------- */
  async function exportPdf() {
    if (displayedWords.length === 0) { YNQ.showToast("出力できる単語がありません"); return; }
    const btn = document.getElementById("btn-export-pdf");
    btn.disabled = true;
    YNQ.showToast("PDFを作成しています...");
    try {
      const table = document.querySelector("#wordlist-content .table-scroll table");
      await YNQ.exportTableAsPdf(table, `${YNQ.currentBook.name}  -  単語一覧`, `${YNQ.currentBook.name}_単語一覧.pdf`);
    } catch (err) {
      console.error("[wordlist:exportPdf]", err);
      YNQ.showToast("PDFの作成に失敗しました");
    } finally {
      btn.disabled = false;
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { init };
})();
