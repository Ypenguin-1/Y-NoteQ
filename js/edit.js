/* ============================================================
   Y-NoteQ edit.js
   「編集」タブ(tabs/edit.html)の描画とデータ操作
   ・直接入力での単語追加 / CSV・Excelインポート
   ・単語ごとの修正(単語No./単語/意味/暗記度)・リセット・削除
   ・範囲/複数No指定での一括削除・一括暗記度設定
   ============================================================ */
window.EditTab = (function () {

  let allWords = []; // 現在の単語帳の全単語(編集のたびに再取得せず、この配列とFirestoreを同期させる)

  function wordsRef() { return YNQ.wordsCol(YNQ.currentFolder.id, YNQ.currentBook.id); }

  /* ---------- 初期表示 ---------- */
  function init() {
    const hasBook = !!(YNQ.currentFolder && YNQ.currentBook);
    document.getElementById("edit-empty").hidden = hasBook;
    document.getElementById("edit-content").hidden = !hasBook;
    if (!hasBook) {
      document.getElementById("btn-edit-goto-folders").addEventListener("click", () => YNQ.loadTab("home"));
      return;
    }
    bindEvents();
    loadWords();
  }

  async function loadWords() {
    const tbody = document.getElementById("edit-word-body");
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);padding:20px;">読み込み中...</td></tr>`;
    try {
      const snap = await wordsRef().orderBy("no", "asc").get();
      allWords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderWordTable();
    } catch (err) {
      console.error("[edit:loadWords]", err);
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-danger);padding:20px;">読み込みに失敗しました</td></tr>`;
    }
  }

  function renderWordTable() {
    document.getElementById("edit-word-count").textContent = `(${allWords.length}件)`;
    const tbody = document.getElementById("edit-word-body");
    if (allWords.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);padding:20px;">単語がまだ登録されていません</td></tr>`;
      return;
    }
    tbody.innerHTML = allWords.map(w => {
      const level = w.level || 0;
      return `
        <tr data-id="${w.id}">
          <td>${YNQ.pad4(w.no)}</td>
          <td class="col-word">${YNQ.escapeHtml(w.word)}</td>
          <td class="col-meaning">${YNQ.escapeHtml(w.meaning)}</td>
          <td><span class="level-pill" style="background:${YNQ.LEVEL_COLORS[level]};cursor:default;">${level}</span></td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn btn-secondary" data-action="edit" data-id="${w.id}">修正</button>
              <button type="button" class="btn btn-secondary" data-action="reset" data-id="${w.id}">リセット</button>
              <button type="button" class="btn btn-danger" data-action="delete" data-id="${w.id}">削除</button>
            </div>
          </td>
        </tr>`;
    }).join("");

    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener("click", () => openWordEditModal(btn.dataset.id)));
    tbody.querySelectorAll('[data-action="reset"]').forEach(btn => btn.addEventListener("click", () => resetWord(btn.dataset.id)));
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener("click", () => deleteWord(btn.dataset.id)));
  }

  /* ---------- 共通ユーティリティ ----------
     Level選択ボタン群(それぞれのLevel自身の色で表示)は
     js/app.js の YNQ.bindLevelToggleGroup / YNQ.setLevelToggleValue を利用する(仕様修正2026/09/12 #2)。 */
  function getToggleValue(containerId) {
    const active = document.querySelector(`#${containerId} .btn-toggle.active`);
    return active ? Number(active.dataset.value) : null;
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
  function nextNo() {
    if (allWords.length === 0) return 1;
    return Math.max(...allWords.map(w => w.no || 0)) + 1;
  }
  // Firestoreのバッチは1回あたり500件までのため、安全のため450件ずつに分けてcommitする
  async function commitInChunks(items, applyFn) {
    const chunkSize = 450;
    for (let i = 0; i < items.length; i += chunkSize) {
      const batch = YNQ.db.batch();
      items.slice(i, i + chunkSize).forEach(item => applyFn(batch, item));
      await batch.commit();
    }
  }

  /* ---------- ①直接入力で単語を追加 ---------- */
  function bindEvents() {
    YNQ.bindLevelToggleGroup("add-word-level", true);
    document.getElementById("btn-add-word").addEventListener("click", addWord);

    document.getElementById("import-file-input").addEventListener("change", handleImportFile);

    document.getElementById("btn-bulk-apply-level").addEventListener("click", bulkApplyLevel);
    document.getElementById("btn-bulk-delete").addEventListener("click", bulkDelete);
    YNQ.bindLevelToggleGroup("bulk-level-group", true);

    YNQ.bindLevelToggleGroup("edit-word-level-group", true);
    document.getElementById("btn-close-word-edit").addEventListener("click", () => YNQ.closeModal("modal-word-edit"));
    document.getElementById("btn-word-edit-cancel").addEventListener("click", () => YNQ.closeModal("modal-word-edit"));
    document.getElementById("btn-word-edit-save").addEventListener("click", saveWordEdit);
  }

  async function addWord() {
    const wordInput = document.getElementById("add-word-input");
    const meaningInput = document.getElementById("add-meaning-input");
    const word = wordInput.value.trim();
    const meaning = meaningInput.value.trim();
    if (!word || !meaning) { YNQ.showToast("単語と意味の両方を入力してください"); return; }
    const level = getToggleValue("add-word-level") || 0;
    const no = nextNo();

    const btn = document.getElementById("btn-add-word");
    btn.disabled = true;
    try {
      const ref = await wordsRef().add({
        no, word, meaning, level,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // 仕様修正2026/09/14: Firestoreの読み取り量削減のため、全件を再取得せずローカルに反映する
      allWords.push({ id: ref.id, no, word, meaning, level, correctStreak: 0 });
      renderWordTable();
      YNQ.updateBookStats(YNQ.currentFolder.id, YNQ.currentBook.id, allWords);
      wordInput.value = ""; meaningInput.value = "";
      YNQ.setLevelToggleValue("add-word-level", 0);
      YNQ.showToast("単語を追加しました");
    } catch (err) {
      console.error("[edit:addWord]", err);
      YNQ.showToast("追加に失敗しました");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- ②CSV / Excel インポート ---------- */
  // RFC4180準拠の簡易CSVパーサー(ダブルクォートで囲まれたフィールド内の改行・カンマ・
  // ""エスケープに対応)。仕様修正2026/09/12 No.5-1: CSVはXLSX.readに任せず自前でパースし、
  // セル内の改行情報(単語・意味に含まれる複数行のテキスト)を確実に保持する。
  function parseCsvText(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // 先頭のBOMを除去
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\r") {
        // 無視(\r\nの\rはスキップし、\nの方で改行を確定する)
      } else if (c === "\n") {
        row.push(field); rows.push(row); row = []; field = "";
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const isCsv = /\.csv$/i.test(file.name);
      let rows;
      if (isCsv) {
        const text = await file.text();
        rows = parseCsvText(text);
      } else {
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      }
      const dataRows = rows.slice(1); // 仕様#87: 1行目は見出しなので2行目から

      const parsed = [];
      dataRows.forEach(row => {
        if (!row || row.length === 0) return;
        const word = String(row[1] ?? "").trim();
        const meaning = String(row[2] ?? "").trim();
        if (!word && !meaning) return; // 空行はスキップ

        const noRaw = parseInt(row[0], 10);
        let level = parseInt(row[3], 10);
        if (isNaN(level)) level = 0; // 仕様#88: 空欄は0判定
        level = Math.max(0, Math.min(5, level)); // Levelは0〜5の範囲にクランプ

        parsed.push({ no: isNaN(noRaw) ? null : noRaw, word, meaning, level });
      });

      if (parsed.length === 0) { YNQ.showToast("インポートできるデータが見つかりませんでした"); e.target.value = ""; return; }

      // 通し番号が空だった行には、既存の最大No.以降を自動で振る
      let autoNo = nextNo();
      parsed.forEach(p => { if (p.no === null) p.no = autoNo++; });

      YNQ.confirmDialog(`${parsed.length}件のデータを読み込みました。単語帳にインポートしますか?`, async () => {
        try {
          const newWords = [];
          await commitInChunks(parsed, (batch, p) => {
            const ref = wordsRef().doc();
            newWords.push({ id: ref.id, no: p.no, word: p.word, meaning: p.meaning, level: p.level, correctStreak: 0 });
            batch.set(ref, {
              no: p.no, word: p.word, meaning: p.meaning, level: p.level,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          });
          // 仕様修正2026/09/14: Firestoreの読み取り量削減のため、全件を再取得せずローカルに反映する
          allWords = allWords.concat(newWords);
          if (isCsv) await renameCurrentBookFromFileName(file.name); // 仕様修正2026/09/12 No.5-3
          renderWordTable();
          YNQ.updateBookStats(YNQ.currentFolder.id, YNQ.currentBook.id, allWords);
          YNQ.showToast(`${parsed.length}件をインポートしました`);
        } catch (err) {
          console.error("[edit:handleImportFile:commit]", err);
          YNQ.showToast("インポートに失敗しました");
        }
      }, "インポートする", false);
    } catch (err) {
      console.error("[edit:handleImportFile]", err);
      YNQ.showToast("ファイルの読み込みに失敗しました。CSV/Excel形式をご確認ください");
    } finally {
      e.target.value = ""; // 同じファイルを連続選択しても change が発火するようにリセット
    }
  }

  // 仕様修正2026/09/12 No.5-3: CSVインポート時、ファイル名(拡張子除く)を単語帳名として反映する
  async function renameCurrentBookFromFileName(fileName) {
    const name = fileName.replace(/\.csv$/i, "").trim();
    if (!name) return;
    try {
      const bookRef = YNQ.db.collection("users").doc(YNQ.currentUser.uid)
        .collection("folders").doc(YNQ.currentFolder.id)
        .collection("wordbooks").doc(YNQ.currentBook.id);
      await bookRef.update({ name, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      YNQ.currentBook.name = name;
      const titleEl = document.getElementById("header-booktitle");
      if (titleEl) titleEl.textContent = name;
    } catch (err) {
      console.error("[edit:renameCurrentBookFromFileName]", err);
    }
  }

  /* ---------- ③一括操作 ---------- */
  function getBulkTargets() {
    const noPredicate = parseNoQuery(document.getElementById("bulk-no-input").value.trim());
    return noPredicate ? allWords.filter(w => noPredicate(w.no)) : allWords.slice();
  }

  function bulkApplyLevel() {
    const level = getToggleValue("bulk-level-group");
    if (level === null) { YNQ.showToast("適用するLevelを選択してください"); return; }
    const targets = getBulkTargets();
    if (targets.length === 0) { YNQ.showToast("対象の単語がありません"); return; }

    YNQ.confirmDialog(`${targets.length}件の暗記度を Level ${level === 0 ? "未実施" : level} に一括変更しますか?`, async () => {
      try {
        await commitInChunks(targets, (batch, w) => {
          const data = { level, correctStreak: 0, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
          if (level === 0) data.lastTestDate = firebase.firestore.FieldValue.delete();
          batch.update(wordsRef().doc(w.id), data);
        });
        // 仕様修正2026/09/14: Firestoreの読み取り量削減のため、全件を再取得せずローカルに反映する
        const targetIds = new Set(targets.map(w => w.id));
        allWords.forEach(w => {
          if (!targetIds.has(w.id)) return;
          w.level = level; w.correctStreak = 0;
          if (level === 0) w.lastTestDate = null;
        });
        renderWordTable();
        YNQ.updateBookStats(YNQ.currentFolder.id, YNQ.currentBook.id, allWords);
        YNQ.showToast("一括変更しました");
      } catch (err) {
        console.error("[edit:bulkApplyLevel]", err);
        YNQ.showToast("一括変更に失敗しました");
      }
    }, "変更する", false);
  }

  function bulkDelete() {
    const targets = getBulkTargets();
    if (targets.length === 0) { YNQ.showToast("対象の単語がありません"); return; }
    YNQ.confirmDialog(`${targets.length}件の単語を削除しますか?\nこの操作は元に戻せません。`, async () => {
      try {
        await commitInChunks(targets, (batch, w) => batch.delete(wordsRef().doc(w.id)));
        // 仕様修正2026/09/14: Firestoreの読み取り量削減のため、全件を再取得せずローカルに反映する
        const targetIds = new Set(targets.map(w => w.id));
        allWords = allWords.filter(w => !targetIds.has(w.id));
        renderWordTable();
        YNQ.updateBookStats(YNQ.currentFolder.id, YNQ.currentBook.id, allWords);
        YNQ.showToast("一括削除しました");
      } catch (err) {
        console.error("[edit:bulkDelete]", err);
        YNQ.showToast("一括削除に失敗しました");
      }
    }, "削除する", true);
  }

  /* ---------- ④単語ごとの修正・リセット・削除 ---------- */
  let editingWordId = null;

  function openWordEditModal(wordId) {
    const w = allWords.find(x => x.id === wordId);
    if (!w) return;
    editingWordId = wordId;
    document.getElementById("edit-word-no").value = w.no;
    document.getElementById("edit-word-word").value = w.word;
    document.getElementById("edit-word-meaning").value = w.meaning;
    document.getElementById("edit-word-error").textContent = "";
    YNQ.setLevelToggleValue("edit-word-level-group", w.level || 0);
    YNQ.openModal("modal-word-edit");
  }

  async function saveWordEdit() {
    const errorEl = document.getElementById("edit-word-error");
    const no = parseInt(document.getElementById("edit-word-no").value, 10);
    const word = document.getElementById("edit-word-word").value.trim();
    const meaning = document.getElementById("edit-word-meaning").value.trim();
    const level = getToggleValue("edit-word-level-group") || 0;

    if (isNaN(no) || no < 1) { errorEl.textContent = "単語No.は1以上の数字で入力してください。"; return; }
    if (!word || !meaning) { errorEl.textContent = "単語と意味の両方を入力してください。"; return; }
    errorEl.textContent = "";

    const saveBtn = document.getElementById("btn-word-edit-save");
    saveBtn.disabled = true;
    try {
      const data = { no, word, meaning, level, correctStreak: 0, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      if (level === 0) data.lastTestDate = firebase.firestore.FieldValue.delete();
      await wordsRef().doc(editingWordId).update(data);
      // 仕様修正2026/09/14: Firestoreの読み取り量削減のため、全件を再取得せずローカルに反映する
      const w = allWords.find(x => x.id === editingWordId);
      if (w) {
        w.no = no; w.word = word; w.meaning = meaning; w.level = level; w.correctStreak = 0;
        if (level === 0) w.lastTestDate = null;
      }
      allWords.sort((a, b) => (a.no || 0) - (b.no || 0)); // 単語No.が変わった場合も表の並び順を保つ
      YNQ.closeModal("modal-word-edit");
      renderWordTable();
      YNQ.updateBookStats(YNQ.currentFolder.id, YNQ.currentBook.id, allWords);
      YNQ.showToast("修正しました");
    } catch (err) {
      console.error("[edit:saveWordEdit]", err);
      errorEl.textContent = "保存に失敗しました。時間をおいて再度お試しください。";
    } finally {
      saveBtn.disabled = false;
    }
  }

  function resetWord(wordId) {
    const w = allWords.find(x => x.id === wordId);
    if (!w) return;
    YNQ.confirmDialog(`「${w.word}」の暗記度を「未実施」に戻しますか?`, async () => {
      try {
        await wordsRef().doc(wordId).update({
          level: 0,
          correctStreak: 0,
          lastTestDate: firebase.firestore.FieldValue.delete(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // 仕様修正2026/09/14: Firestoreの読み取り量削減のため、全件を再取得せずローカルに反映する
        w.level = 0; w.correctStreak = 0; w.lastTestDate = null;
        renderWordTable();
        YNQ.updateBookStats(YNQ.currentFolder.id, YNQ.currentBook.id, allWords);
        YNQ.showToast("未実施に戻しました");
      } catch (err) {
        console.error("[edit:resetWord]", err);
        YNQ.showToast("リセットに失敗しました");
      }
    }, "リセットする", false);
  }

  function deleteWord(wordId) {
    const w = allWords.find(x => x.id === wordId);
    if (!w) return;
    YNQ.confirmDialog(`単語「${w.word}」を削除しますか?\nこの操作は元に戻せません。`, async () => {
      try {
        await wordsRef().doc(wordId).delete();
        // 仕様修正2026/09/14: Firestoreの読み取り量削減のため、全件を再取得せずローカルに反映する
        allWords = allWords.filter(x => x.id !== wordId);
        renderWordTable();
        YNQ.updateBookStats(YNQ.currentFolder.id, YNQ.currentBook.id, allWords);
        YNQ.showToast("削除しました");
      } catch (err) {
        console.error("[edit:deleteWord]", err);
        YNQ.showToast("削除に失敗しました");
      }
    }, "削除する", true);
  }

  return { init };
})();
