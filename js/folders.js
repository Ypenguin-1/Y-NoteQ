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

  // 仕様修正2026/09/14: Firestoreの読み取り量削減のため、単語帳の件数・Level別集計を
  // 単語帳ドキュメント自体に事前計算して持たせておく(フォルダー一覧・単語帳一覧・アカウントタブの
  // 集計表示が、単語を1件ずつ読みに行かずにこの事前計算値を読むだけで済むようにする)。
  // 単語の追加/編集/削除のたびに、その時点でメモリ上にある単語配列から計算して書き込むだけなので、
  // 追加のFirestore読み取りは発生しない。
  function computeLevelCounts(words) {
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    (words || []).forEach(w => { const lv = w.level || 0; counts[lv] = (counts[lv] || 0) + 1; });
    return counts;
  }
  YNQ.computeLevelCounts = computeLevelCounts;

  async function updateBookStats(folderId, bookId, words) {
    try {
      await booksCol(folderId).doc(bookId).update({
        wordCount: words.length,
        levelCounts: computeLevelCounts(words)
      });
    } catch (err) {
      console.error("[folders:updateBookStats]", err);
    }
  }
  YNQ.updateBookStats = updateBookStats; // js/edit.js・js/wordlist.js・js/test.js から参照するため公開

  /* ---------- 初期表示 ---------- */
  function init() {
    bindStaticEvents();
    applyViewModeUI();
    render();
  }

  function render() {
    if (YNQ.currentFolder) {
      renderWordbooks(YNQ.currentFolder);
    } else {
      renderFolders();
    }
  }

  // 仕様追加2026/09/13 No.1-5: 正方形カード表示/一覧表示の切り替え(選択状態はlocalStorageに保存)
  function currentViewMode() {
    return localStorage.getItem("ynoteq-folders-view") === "list" ? "list" : "grid";
  }
  function applyViewModeUI() {
    const mode = currentViewMode();
    document.getElementById("folders-grid").classList.toggle("list-view", mode === "list");
    document.querySelectorAll("#folders-view-toggle [data-view]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.view === mode);
    });
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

  function renderBookProgressEl(el, total, counts) {
    if (total === 0) {
      el.innerHTML = `<span class="item-progress-empty">単語なし</span>`;
      return;
    }
    const order = [1, 2, 3, 4, 5, 0]; // 仕様#45と同じ並び順
    el.innerHTML = `
      <div class="item-progress-bar">${order.map(lv => {
        const pct = ((counts[lv] || 0) / total) * 100;
        return pct > 0 ? `<div class="item-progress-seg" style="width:${pct}%;background:${YNQ.LEVEL_COLORS[lv]}" title="Level${lv}: ${counts[lv]}件"></div>` : "";
      }).join("")}</div>
      <span class="item-progress-count">${total}語</span>`;
  }

  // 各単語帳のLevel別ミニ進捗バーを表示する。仕様修正2026/09/14: 単語帳ドキュメントに事前計算済みの
  // wordCount/levelCountsがあれば追加の読み取りなしでそのまま表示する。まだ集計されていない
  // 古いデータの単語帳だけ、その場で単語を読んで集計し、次回のためにFirestoreへ書き戻す(自己修復)。
  async function loadBookProgress(folderId, books) {
    await Promise.all(books.map(async (b) => {
      const el = document.querySelector(`.item-progress[data-book-id="${CSS.escape(b.id)}"]`);
      if (!el) return;
      if (typeof b.wordCount === "number" && b.levelCounts) {
        renderBookProgressEl(el, b.wordCount, b.levelCounts);
        return;
      }
      try {
        const wsnap = await wordsCol(folderId, b.id).get();
        const words = wsnap.docs.map(d => d.data());
        const counts = computeLevelCounts(words);
        const total = wsnap.size;
        renderBookProgressEl(el, total, counts);
        booksCol(folderId).doc(b.id).update({ wordCount: total, levelCounts: counts }).catch(() => {});
      } catch (err) {
        console.error("[folders:loadBookProgress]", err);
        el.innerHTML = `<span class="item-progress-empty">取得失敗</span>`;
      }
    }));
  }

  // 各フォルダーの中の単語帳数を表示する(仕様#8)。仕様修正2026/09/14: フォルダードキュメントに
  // 事前計算済みのbookCountがあれば追加の読み取りなしで表示し、無い古いデータだけその場で数えて書き戻す。
  async function loadFolderCounts(folders) {
    await Promise.all(folders.map(async (f) => {
      const el = document.querySelector(`.item-card-count[data-count-folder-id="${CSS.escape(f.id)}"]`);
      if (!el) return;
      if (typeof f.bookCount === "number") {
        el.innerHTML = `<i class="fa-solid fa-book"></i> ${f.bookCount}単語帳`;
        return;
      }
      try {
        const snap = await booksCol(f.id).get();
        el.innerHTML = `<i class="fa-solid fa-book"></i> ${snap.size}単語帳`;
        foldersCol().doc(f.id).update({ bookCount: snap.size }).catch(() => {});
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
    // 仕様追加2026/09/13 No.1-15: 単語帳カードには「共有」タブへ移動するアイコンも設置する
    const shareBtn = kind === "book"
      ? `<button type="button" class="btn-icon" data-action="share" title="共有する"><i class="fa-solid fa-share-nodes"></i></button>`
      : "";
    return `
      <div class="item-card" data-id="${item.id}">
        <div class="item-card-actions">
          ${shareBtn}
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

    // 仕様追加2026/09/13 No.1-15: 単語帳の「共有」アイコン→共有タブへ移動し、その単語帳を選択しておく
    const shareBtn = card.querySelector('[data-action="share"]');
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        YNQ.shareTargetBook = { folderId: item.folderId, bookId: item.id };
        YNQ.loadTab("share");
      });
    }
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

    document.querySelectorAll("#folders-view-toggle [data-view]").forEach(btn => {
      btn.addEventListener("click", () => {
        localStorage.setItem("ynoteq-folders-view", btn.dataset.view);
        applyViewModeUI();
      });
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
        const initData = {
          name, description, color: editState.color,
          order: Date.now(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        // 仕様修正2026/09/14: 読み取り量削減のため、件数・Level集計を作成時点から0で持たせておく
        if (editState.mode === "folder") {
          initData.bookCount = 0;
        } else {
          initData.wordCount = 0;
          initData.levelCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        }
        await col.add(initData);
        if (editState.mode === "book") {
          // 単語帳を新規作成したら、親フォルダーの単語帳数を+1する(追加の読み取りは発生しない)
          foldersCol().doc(YNQ.currentFolder.id)
            .update({ bookCount: firebase.firestore.FieldValue.increment(1) })
            .catch(err => console.error("[folders:saveItem:bookCount]", err));
        }
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
    }, "削除する", true);
  }

  // 単語帳を削除する前に、中の単語をすべて削除する(Firestoreにサブコレクションの自動カスケード削除はないため)
  async function deleteWordbookCascade(folderId, bookId) {
    const wordsSnap = await wordsCol(folderId, bookId).get();
    await Promise.all(wordsSnap.docs.map(d => d.ref.delete()));
    await booksCol(folderId).doc(bookId).delete();
    // 親フォルダーの単語帳数を-1する(仕様修正2026/09/14。フォルダーごと削除される場合は
    // このあとフォルダー自体も削除されるため無害)
    foldersCol().doc(folderId)
      .update({ bookCount: firebase.firestore.FieldValue.increment(-1) })
      .catch(() => {});
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
