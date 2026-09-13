/* ============================================================
   Y-NoteQ share.js
   「共有」タブ(tabs/share.html)の描画とデータ操作(仕様追加2026/09/12 No.4)
   ・自分の単語帳をsharedWordbooksコレクションへ共有(単語・意味のみ、level等は含めない)
   ・共有されている単語帳(公式含む)の一覧表示・インストール
     (インストールすると自分の「共有された単語帳」フォルダーにコピーされる)
   ============================================================ */
window.ShareTab = (function () {

  let sharedList = []; // 直近に取得した共有単語帳一覧

  function uid() { return YNQ.currentUser && YNQ.currentUser.uid; }
  function foldersCol() { return YNQ.db.collection("users").doc(uid()).collection("folders"); }
  function booksCol(folderId) { return foldersCol().doc(folderId).collection("wordbooks"); }
  function wordsCol(folderId, bookId) { return booksCol(folderId).doc(bookId).collection("words"); }
  function sharedCol() { return YNQ.db.collection("sharedWordbooks"); }

  async function init() {
    bindEvents();
    await loadOwnBooks();

    // 仕様追加2026/09/13 No.1-15: フォルダー一覧の単語帳カードから共有タブに飛んできた場合、
    // その単語帳を共有フォームにあらかじめ選択しておく(js/folders.jsから設定される)
    if (YNQ.shareTargetBook) {
      const target = YNQ.shareTargetBook;
      YNQ.shareTargetBook = null;
      const select = document.getElementById("share-source-select");
      select.value = `${target.folderId}::${target.bookId}`;
    }

    loadSharedList();
  }

  function bindEvents() {
    document.getElementById("btn-share-publish").addEventListener("click", publishSelectedBook);

    // 仕様追加2026/09/13 No.1-15: パスワード付き単語帳のインストール確認モーダル
    document.getElementById("btn-close-share-password").addEventListener("click", () => YNQ.closeModal("modal-share-password"));
    document.getElementById("btn-share-password-cancel").addEventListener("click", () => YNQ.closeModal("modal-share-password"));
  }

  /* ---------- 自分の単語帳を共有する ---------- */
  async function loadOwnBooks() {
    const select = document.getElementById("share-source-select");
    select.innerHTML = `<option value="">読み込み中...</option>`;
    try {
      const foldersSnap = await foldersCol().orderBy("order", "asc").get();
      const options = [];
      for (const fDoc of foldersSnap.docs) {
        const folder = fDoc.data();
        const booksSnap = await booksCol(fDoc.id).orderBy("order", "asc").get();
        booksSnap.forEach(bDoc => {
          options.push({ folderId: fDoc.id, folderName: folder.name, bookId: bDoc.id, bookName: bDoc.data().name });
        });
      }
      if (options.length === 0) {
        select.innerHTML = `<option value="">共有できる単語帳がありません</option>`;
        return;
      }
      select.innerHTML = `<option value="">選択してください</option>` + options.map(o =>
        `<option value="${o.folderId}::${o.bookId}">${YNQ.escapeHtml(o.folderName)} / ${YNQ.escapeHtml(o.bookName)}</option>`
      ).join("");
    } catch (err) {
      console.error("[share:loadOwnBooks]", err);
      select.innerHTML = `<option value="">読み込みに失敗しました</option>`;
    }
  }

  async function publishSelectedBook() {
    const select = document.getElementById("share-source-select");
    const [folderId, bookId] = (select.value || "").split("::");
    if (!folderId || !bookId) { YNQ.showToast("共有する単語帳を選択してください"); return; }
    const description = document.getElementById("share-desc-input").value.trim();
    const password = document.getElementById("share-password-input").value.trim(); // 仕様追加2026/09/13 No.1-15

    const btn = document.getElementById("btn-share-publish");
    btn.disabled = true;
    try {
      const bookDoc = await booksCol(folderId).doc(bookId).get();
      if (!bookDoc.exists) { YNQ.showToast("単語帳が見つかりませんでした"); return; }
      const bookData = bookDoc.data();

      const wordsSnap = await wordsCol(folderId, bookId).orderBy("no", "asc").get();
      if (wordsSnap.empty) { YNQ.showToast("単語が登録されていない単語帳は共有できません"); return; }

      let authorName = YNQ.currentUser.email ? YNQ.currentUser.email.split("@")[0] : "不明なユーザー";
      try {
        const userDoc = await YNQ.db.collection("users").doc(uid()).get();
        if (userDoc.exists && userDoc.data().username) authorName = userDoc.data().username;
      } catch (e) { /* ユーザー名が取れなくても共有自体は続行する */ }

      const sharedRef = await sharedCol().add({
        name: bookData.name,
        description,
        password: password || null, // 仕様追加2026/09/13 No.1-15: 未設定(null)ならパスワードなしでインストール可能
        wordCount: wordsSnap.size,
        authorUid: uid(),
        authorName,
        official: false, // 公式フラグはFirebaseコンソールから手動で付与する運用(firestore.rules参照)
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // 単語・意味のみをコピーする(暗記度やテスト記録などの個人の学習状況は含めない)
      const batch = YNQ.db.batch();
      wordsSnap.docs.forEach(d => {
        const w = d.data();
        batch.set(sharedRef.collection("words").doc(), { no: w.no, word: w.word, meaning: w.meaning });
      });
      await batch.commit();

      document.getElementById("share-desc-input").value = "";
      document.getElementById("share-password-input").value = "";
      select.value = "";
      YNQ.showToast("単語帳を共有しました");
      loadSharedList();
    } catch (err) {
      console.error("[share:publishSelectedBook]", err);
      YNQ.showToast("共有に失敗しました");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- 共有されている単語帳の一覧・インストール ---------- */
  async function loadSharedList() {
    const grid = document.getElementById("shared-list-grid");
    grid.innerHTML = `<div class="placeholder-card"><i class="fa-solid fa-spinner fa-spin"></i><p>読み込み中...</p></div>`;
    try {
      const snap = await sharedCol().orderBy("createdAt", "desc").limit(50).get();
      sharedList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (sharedList.length === 0) {
        grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-share-nodes"></i><h3>共有されている単語帳はまだありません</h3><p>上のフォームから自分の単語帳を共有してみましょう。</p></div>`;
        return;
      }
      grid.innerHTML = sharedList.map(sharedCardHtml).join("");
      sharedList.forEach(s => {
        const installBtn = grid.querySelector(`[data-install-id="${CSS.escape(s.id)}"]`);
        if (installBtn) installBtn.addEventListener("click", () => installSharedBook(s));
        // 仕様修正2026/09/12 No.3-3: 投稿者本人のみ「共有を中止」できる
        const unshareBtn = grid.querySelector(`[data-unshare-id="${CSS.escape(s.id)}"]`);
        if (unshareBtn) unshareBtn.addEventListener("click", () => unshareBook(s));
      });
    } catch (err) {
      console.error("[share:loadSharedList]", err);
      grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>読み込みに失敗しました</h3><p>${YNQ.escapeHtml(err.message)}</p></div>`;
    }
  }

  function sharedCardHtml(s) {
    const desc = s.description ? YNQ.escapeHtml(s.description) : "";
    const isOwner = YNQ.currentUser && s.authorUid === YNQ.currentUser.uid;
    return `
      <div class="item-card shared-card">
        <div class="shared-card-header">
          <span class="item-card-name">${YNQ.escapeHtml(s.name)}</span>
          ${s.official ? `<span class="badge-official"><i class="fa-solid fa-certificate"></i> 公式</span>` : ""}
          ${s.password ? `<span class="badge-official" style="background:var(--color-bg-elevated);color:var(--color-text-muted);"><i class="fa-solid fa-lock"></i> パスワード制</span>` : ""}
        </div>
        <p class="item-card-desc">${desc}</p>
        <div class="shared-card-meta">
          <span><i class="fa-solid fa-book"></i> ${s.wordCount || 0}単語</span>
          <span><i class="fa-solid fa-user"></i> ${YNQ.escapeHtml(s.authorName || "不明")}</span>
        </div>
        <div class="shared-card-actions">
          <button type="button" class="btn btn-primary btn-block" data-install-id="${s.id}"><i class="fa-solid fa-download"></i> インストール</button>
          ${isOwner ? `<button type="button" class="btn btn-secondary btn-block" data-unshare-id="${s.id}"><i class="fa-solid fa-ban"></i> 共有を中止</button>` : ""}
        </div>
      </div>`;
  }

  // 仕様追加2026/09/13 No.1-15: パスワードが設定されている場合は先に照合する
  function installSharedBook(shared) {
    if (shared.password) {
      openSharePasswordModal(shared);
    } else {
      confirmAndInstall(shared);
    }
  }

  function openSharePasswordModal(shared) {
    const input = document.getElementById("share-password-confirm-input");
    const errorEl = document.getElementById("share-password-error");
    input.value = "";
    errorEl.textContent = "";
    YNQ.openModal("modal-share-password");
    input.focus();

    const okBtn = document.getElementById("btn-share-password-ok");
    const newOkBtn = okBtn.cloneNode(true); // 直前のリスナー(別の単語帳向け)を消すため差し替える
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    newOkBtn.addEventListener("click", () => {
      if (input.value !== shared.password) {
        errorEl.textContent = "パスワードが違います。";
        return;
      }
      YNQ.closeModal("modal-share-password");
      confirmAndInstall(shared);
    });
  }

  function confirmAndInstall(shared) {
    YNQ.confirmDialog(`「${shared.name}」を自分の単語帳としてインストールしますか?\n「共有された単語帳」フォルダーに追加されます。`, async () => {
      try {
        const folderId = await ensureSharedFolder();
        const newBookRef = await booksCol(folderId).add({
          name: shared.name,
          description: shared.description || "",
          color: "#0ea5e9",
          order: Date.now(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const wordsSnap = await sharedCol().doc(shared.id).collection("words").orderBy("no", "asc").get();
        const batch = YNQ.db.batch();
        wordsSnap.docs.forEach(d => {
          const w = d.data();
          batch.set(wordsCol(folderId, newBookRef.id).doc(), {
            no: w.no, word: w.word, meaning: w.meaning, level: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        YNQ.showToast("インストールしました(「共有された単語帳」フォルダーに追加されました)");
      } catch (err) {
        console.error("[share:installSharedBook]", err);
        YNQ.showToast("インストールに失敗しました");
      }
    }, "インストールする", false);
  }

  // 仕様修正2026/09/12 No.3-3: 投稿者本人が共有を中止(削除)できるようにする
  function unshareBook(shared) {
    YNQ.confirmDialog(`「${shared.name}」の共有を中止しますか?\n共有一覧から削除され、他のユーザーはインストールできなくなります(すでにインストール済みの単語帳には影響しません)。`, async () => {
      try {
        // firestore.rulesの仕様上、サブコレクションのwordsは親ドキュメントが存在する間しか
        // authorUidの照合ができないため、先にwordsを削除し、最後に親ドキュメントを削除する
        const wordsSnap = await sharedCol().doc(shared.id).collection("words").get();
        await Promise.all(wordsSnap.docs.map(d => d.ref.delete()));
        await sharedCol().doc(shared.id).delete();
        YNQ.showToast("共有を中止しました");
        loadSharedList();
      } catch (err) {
        console.error("[share:unshareBook]", err);
        YNQ.showToast("共有の中止に失敗しました");
      }
    }, "共有を中止する", true);
  }

  // 「共有された単語帳」という名前の専用フォルダーを取得する(なければ新規作成する)
  async function ensureSharedFolder() {
    const name = "共有された単語帳";
    const snap = await foldersCol().where("name", "==", name).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
    const ref = await foldersCol().add({
      name,
      description: "「共有」タブからインストールした単語帳が入ります",
      color: "#0ea5e9",
      order: Date.now(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  }

  return { init };
})();
