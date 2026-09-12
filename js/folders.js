/* ============================================================
   Y-NoteQ folders.js
   「フォルダー」タブ(tabs/home.html)の描画とデータ操作
   ・フォルダー/単語帳の一覧表示
   ・新規作成/名前・カラー編集/削除(カスケード削除込み)
   ・単語帳を開くと js/app.js の openWordbook() 経由で単語一覧タブへ遷移
   ============================================================ */
window.FoldersTab = (function () {

  // フォルダー・単語帳のアイコンカラー選択肢
  const ITEM_COLORS = ["#F2CF00", "#2a8cef", "#72ef2a", "#fa6c19", "#ff4e4d", "#a855f7", "#0ea5e9", "#22c55e"];

  // 編集モーダルの状態(新規作成中 or 既存アイテム編集中)
  let editState = { mode: "folder", id: null, color: ITEM_COLORS[0], description: "" };

  function uid() { return YNQ.currentUser && YNQ.currentUser.uid; }
  function foldersCol() { return YNQ.db.collection("users").doc(uid()).collection("folders"); }
  function booksCol(folderId) { return foldersCol().doc(folderId).collection("wordbooks"); }
  function wordsCol(folderId, bookId) { return booksCol(folderId).doc(bookId).collection("words"); }
  YNQ.wordsCol = wordsCol; // js/wordlist.js から参照するため公開

  /* ---------- 初期表示 ---------- */
  function init() {
    bindStaticEvents();
    render();
  }

  function render() {
    if (YNQ.currentFolder) {
      renderWordbooks(YNQ.currentFolder);
    } else {
      renderFolders();
    }
  }

  /* ---------- フォルダー一覧(トップ階層) ---------- */
  async function renderFolders() {
    document.getElementById("folders-breadcrumb").innerHTML = `<i class="fa-solid fa-folder-open breadcrumb-icon"></i> マイフォルダー`;
    document.getElementById("btn-add-new-label").textContent = "新規フォルダー";
    const grid = document.getElementById("folders-grid");
    grid.innerHTML = `<div class="placeholder-card"><i class="fa-solid fa-spinner fa-spin"></i><p>読み込み中...</p></div>`;

    try {
      const snap = await foldersCol().orderBy("order", "asc").get();
      const folders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (folders.length === 0) {
        grid.innerHTML = emptyStateHtml("フォルダーがまだありません", "右上の「+ 新規フォルダー」から作成してください", "fa-folder-open");
        return;
      }
      grid.innerHTML = folders.map(f => itemCardHtml(f, "folder")).join("");
      folders.forEach(f => bindCardEvents(grid, f, "folder"));
      loadFolderCounts(folders); // 仕様#8: フォルダーカードに中の単語帳数を表示する
    } catch (err) {
      console.error("[folders:renderFolders]", err);
      grid.innerHTML = emptyStateHtml("読み込みに失敗しました", err.message, "fa-triangle-exclamation");
    }
  }

  /* ---------- 単語帳一覧(フォルダーを開いた時) ---------- */
  async function renderWordbooks(folder) {
    document.getElementById("folders-breadcrumb").innerHTML = `
      <button type="button" class="breadcrumb-back" id="btn-back-to-folders"><i class="fa-solid fa-angle-left"></i> フォルダー一覧</button>
      <span>/</span>
      <i class="fa-solid fa-folder breadcrumb-icon" style="color:${folder.color}"></i> ${YNQ.escapeHtml(folder.name)}
    `;
    document.getElementById("btn-back-to-folders").addEventListener("click", () => {
      YNQ.currentFolder = null;
      YNQ.pushNavState("home"); // 仕様修正2026/09/12 #5: ヘッダーの「戻る」で1つ前(フォルダー一覧)に戻れるようにする
      render();
    });
    document.getElementById("btn-add-new-label").textContent = "新規単語帳";

    const grid = document.getElementById("folders-grid");
    grid.innerHTML = `<div class="placeholder-card"><i class="fa-solid fa-spinner fa-spin"></i><p>読み込み中...</p></div>`;

    try {
      const snap = await booksCol(folder.id).orderBy("order", "asc").get();
      const books = snap.docs.map(d => ({ id: d.id, ...d.data(), folderId: folder.id }));
      if (books.length === 0) {
        grid.innerHTML = emptyStateHtml("単語帳がまだありません", "右上の「+ 新規単語帳」から作成してください", "fa-book");
        return;
      }
      grid.innerHTML = books.map(b => itemCardHtml(b, "book")).join("");
      books.forEach(b => bindCardEvents(grid, b, "book"));
      loadBookProgress(folder.id, books); // 仕様#4: 単語帳ごとのLevel別進捗をひと目で分かるように非同期で追加表示
    } catch (err) {
      console.error("[folders:renderWordbooks]", err);
      grid.innerHTML = emptyStateHtml("読み込みに失敗しました", err.message, "fa-triangle-exclamation");
    }
  }

  // 各単語帳の中の単語を集計し、カード内にLevel別のミニ進捗バーを表示する
  async function loadBookProgress(folderId, books) {
    await Promise.all(books.map(async (b) => {
      const el = document.querySelector(`.item-progress[data-book-id="${CSS.escape(b.id)}"]`);
      if (!el) return;
      try {
        const wsnap = await wordsCol(folderId, b.id).get();
        const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        wsnap.forEach(d => { const lv = d.data().level || 0; counts[lv] = (counts[lv] || 0) + 1; });
        const total = wsnap.size;
        if (total === 0) {
          el.innerHTML = `<span class="item-progress-empty">単語なし</span>`;
          return;
        }
        const order = [1, 2, 3, 4, 5, 0]; // 仕様#45と同じ並び順
        el.innerHTML = `
          <div class="item-progress-bar">${order.map(lv => {
            const pct = (counts[lv] / total) * 100;
            return pct > 0 ? `<div class="item-progress-seg" style="width:${pct}%;background:${YNQ.LEVEL_COLORS[lv]}" title="Level${lv}: ${counts[lv]}件"></div>` : "";
          }).join("")}</div>
          <span class="item-progress-count">${total}語</span>`;
      } catch (err) {
        console.error("[folders:loadBookProgress]", err);
        el.innerHTML = `<span class="item-progress-empty">取得失敗</span>`;
      }
    }));
  }

  // 各フォルダーの中の単語帳数を集計し、カードに表示する(仕様#8)
  async function loadFolderCounts(folders) {
    await Promise.all(folders.map(async (f) => {
      const el = document.querySelector(`.item-card-count[data-count-folder-id="${CSS.escape(f.id)}"]`);
      if (!el) return;
      try {
        const snap = await booksCol(f.id).get();
        el.innerHTML = `<i class="fa-solid fa-book"></i> ${snap.size}単語帳`;
      } catch (err) {
        console.error("[folders:loadFolderCounts]", err);
        el.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> 取得失敗`;
      }
    }));
  }

  function emptyStateHtml(title, body, icon) {
    return `<div class="empty-state"><i class="fa-solid ${icon}"></i><h3>${YNQ.escapeHtml(title)}</h3><p>${YNQ.escapeHtml(body)}</p></div>`;
  }

  // 仕様修正2026/09/12 No.8: 小さいブロック→正方形のブロックに変更し、
  // 名前・説明(任意)・件数(フォルダー→単語帳数 / 単語帳→単語数)を表示する。
  function itemCardHtml(item, kind) {
    const icon = kind === "book" ? "fa-book" : "fa-folder";
    const color = item.color || ITEM_COLORS[0];
    const desc = item.description ? YNQ.escapeHtml(item.description) : "";
    // フォルダーカードのみ、下段に「中の単語帳数」の差し込み枠を追加する(単語帳側はitem-progressの件数表示で兼ねる)
    const countRow = kind === "folder"
      ? `<div class="item-card-count" data-count-folder-id="${item.id}"><i class="fa-solid fa-spinner fa-spin"></i></div>`
      : "";
    // 単語帳カードのみ、下段にLevel別ミニ進捗バーの差し込み枠を追加する(仕様#4)
    const progressRow = kind === "book"
      ? `<div class="item-progress" data-book-id="${item.id}"><span class="item-progress-loading">読み込み中...</span></div>`
      : "";
    return `
      <div class="item-card" data-id="${item.id}">
        <div class="item-card-actions">
          <button type="button" class="btn-icon" data-action="edit" title="編集"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="btn-icon" data-action="delete" title="削除"><i class="fa-solid fa-trash"></i></button>
        </div>
        <button type="button" class="item-card-body" data-action="open">
          <i class="fa-solid ${icon} item-card-icon" style="color:${color}"></i>
          <span class="item-card-name">${YNQ.escapeHtml(item.name)}</span>
          <p class="item-card-desc">${desc}</p>
          ${countRow}
        </button>
        ${progressRow}
      </div>`;
  }

  function bindCardEvents(grid, item, kind) {
    const card = grid.querySelector(`.item-card[data-id="${CSS.escape(item.id)}"]`);
    if (!card) return;
    card.querySelector('[data-action="open"]').addEventListener("click", () => {
      if (kind === "folder") {
        YNQ.currentFolder = item;
        YNQ.pushNavState("home"); // 仕様修正2026/09/12 #5: フォルダーを開く操作も履歴に積む
        render();
      } else {
        YNQ.openWordbook(YNQ.currentFolder, item);
      }
    });
    card.querySelector('[data-action="edit"]').addEventListener("click", () => openEditModal(kind, item));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => confirmDelete(kind, item));
  }

  /* ---------- 新規作成・編集モーダル ---------- */
  function bindStaticEvents() {
    document.getElementById("btn-add-new").addEventListener("click", () => {
      openEditModal(YNQ.currentFolder ? "book" : "folder", null);
    });
    document.getElementById("btn-close-item-edit").addEventListener("click", () => YNQ.closeModal("modal-item-edit"));
    document.getElementById("btn-item-edit-cancel").addEventListener("click", () => YNQ.closeModal("modal-item-edit"));
    document.getElementById("btn-item-edit-save").addEventListener("click", saveItem);
    document.getElementById("item-edit-custom-color").addEventListener("input", (e) => {
      editState.color = e.target.value;
      document.querySelectorAll("#item-edit-colors .color-swatch").forEach(b => b.classList.remove("selected"));
    });
  }

  function openEditModal(kind, item) {
    editState = { mode: kind, id: item ? item.id : null, color: (item && item.color) || ITEM_COLORS[0], description: (item && item.description) || "" };
    document.getElementById("item-edit-title").textContent = item
      ? (kind === "folder" ? "フォルダーを編集" : "単語帳を編集")
      : (kind === "folder" ? "新規フォルダー" : "新規単語帳");
    document.getElementById("item-edit-name").value = item ? item.name : "";
    document.getElementById("item-edit-name-error").textContent = "";
    document.getElementById("item-edit-desc").value = editState.description;
    renderColorSwatches();
    YNQ.openModal("modal-item-edit");
    document.getElementById("item-edit-name").focus();
  }

  function renderColorSwatches() {
    const wrap = document.getElementById("item-edit-colors");
    wrap.innerHTML = ITEM_COLORS.map(c => `
      <button type="button" class="color-swatch${c === editState.color ? " selected" : ""}" style="background:${c}" data-color="${c}"></button>
    `).join("");
    wrap.querySelectorAll(".color-swatch").forEach(btn => {
      btn.addEventListener("click", () => {
        editState.color = btn.dataset.color;
        wrap.querySelectorAll(".color-swatch").forEach(b => b.classList.toggle("selected", b === btn));
        document.getElementById("item-edit-custom-color").value = editState.color;
      });
    });
    // 仕様#8: プリセットに加えてRGBを自由に選べるネイティブカラーピッカー
    document.getElementById("item-edit-custom-color").value = editState.color;
  }

  async function saveItem() {
    const nameInput = document.getElementById("item-edit-name");
    const name = nameInput.value.trim();
    const description = document.getElementById("item-edit-desc").value.trim();
    const errorEl = document.getElementById("item-edit-name-error");
    if (!name) { errorEl.textContent = "名前を入力してください。"; return; }
    errorEl.textContent = "";

    const saveBtn = document.getElementById("btn-item-edit-save");
    saveBtn.disabled = true;
    try {
      const col = editState.mode === "folder" ? foldersCol() : booksCol(YNQ.currentFolder.id);
      if (editState.id) {
        await col.doc(editState.id).update({
          name, description, color: editState.color,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        await col.add({
          name, description, color: editState.color,
          order: Date.now(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      YNQ.closeModal("modal-item-edit");
      YNQ.showToast(editState.id ? "更新しました" : "作成しました");
      render();
    } catch (err) {
      console.error("[folders:saveItem]", err);
      errorEl.textContent = "保存に失敗しました。時間をおいて再度お試しください。";
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ---------- 削除(確認ダイアログ→カスケード削除) ---------- */
  function confirmDelete(kind, item) {
    const message = kind === "folder"
      ? `フォルダー「${item.name}」を削除しますか?\n中の単語帳・単語もすべて削除され、元に戻せません。`
      : `単語帳「${item.name}」を削除しますか?\n中の単語もすべて削除され、元に戻せません。`;
    YNQ.confirmDialog(message, async () => {
      try {
        if (kind === "folder") {
          await deleteFolderCascade(item.id);
        } else {
          await deleteWordbookCascade(YNQ.currentFolder.id, item.id);
        }
        YNQ.showToast("削除しました");
        render();
      } catch (err) {
        console.error("[folders:confirmDelete]", err);
        YNQ.showToast("削除に失敗しました");
      }
    });
  }

  // 単語帳を削除する前に、中の単語をすべて削除する(Firestoreにサブコレクションの自動カスケード削除はないため)
  async function deleteWordbookCascade(folderId, bookId) {
    const wordsSnap = await wordsCol(folderId, bookId).get();
    await Promise.all(wordsSnap.docs.map(d => d.ref.delete()));
    await booksCol(folderId).doc(bookId).delete();
  }

  // フォルダーを削除する前に、中の単語帳を(その中の単語ごと)すべて削除する
  async function deleteFolderCascade(folderId) {
    const booksSnap = await booksCol(folderId).get();
    for (const bookDoc of booksSnap.docs) {
      await deleteWordbookCascade(folderId, bookDoc.id);
    }
    await foldersCol().doc(folderId).delete();
  }

  return { init };
})();
