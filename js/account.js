/* ============================================================
   Y-NoteQ account.js
   「アカウント」タブ(tabs/account.html)の描画とデータ取得
   ・ユーザーネーム / アイコン
   ・個人Level(全フォルダー・全単語帳を横断した暗記度の集計)
   ・テスト実施記録(直近20件、仕様#82)
   ============================================================ */
window.AccountTab = (function () {

  function init() {
    loadProfile();
    loadLevelAggregate();
    loadTestHistory();
    bindEvents();
  }

  function bindEvents() {
    document.getElementById("btn-save-username").addEventListener("click", saveUsername);
    document.getElementById("account-username-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveUsername();
    });
  }

  /* ---------- プロフィール(ユーザーネーム・アイコン) ---------- */
  async function loadProfile() {
    const user = YNQ.currentUser;
    document.getElementById("account-email").textContent = user.email || "";

    let username = user.email ? user.email.split("@")[0] : "不明なユーザー";
    let color = YNQ.AVATAR_COLORS[YNQ.hashString(user.uid) % YNQ.AVATAR_COLORS.length];

    try {
      const doc = await YNQ.db.collection("users").doc(user.uid).get();
      if (doc.exists) {
        const data = doc.data();
        if (data.username) username = data.username;
        if (data.avatarColor) color = data.avatarColor;
      }
    } catch (err) {
      console.error("[account:loadProfile]", err);
    }

    document.getElementById("account-username-input").value = username;
    const avatarEl = document.getElementById("account-avatar-large");
    avatarEl.textContent = username[0] ? username[0].toUpperCase() : "?";
    avatarEl.style.background = color;
  }

  // 仕様#6: プロフィール欄でユーザーネームを変更できるようにする
  async function saveUsername() {
    const input = document.getElementById("account-username-input");
    const newName = input.value.trim();
    if (!newName) { YNQ.showToast("ユーザーネームを入力してください"); return; }

    const btn = document.getElementById("btn-save-username");
    btn.disabled = true;
    try {
      await YNQ.db.collection("users").doc(YNQ.currentUser.uid).set({ username: newName }, { merge: true });
      input.value = newName;
      document.getElementById("account-avatar-large").textContent = newName[0].toUpperCase();
      YNQ.showToast("ユーザーネームを更新しました");
    } catch (err) {
      console.error("[account:saveUsername]", err);
      YNQ.showToast("更新に失敗しました");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- 個人Level(collectionGroupで全単語帳の単語を横断集計) ---------- */
  async function loadLevelAggregate() {
    const bar = document.getElementById("account-level-bar");
    const legend = document.getElementById("account-level-legend");
    try {
      const snap = await YNQ.db.collectionGroup("words").get();
      const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      snap.forEach(doc => {
        const lv = doc.data().level || 0;
        counts[lv] = (counts[lv] || 0) + 1;
      });
      const total = snap.size;

      if (total === 0) {
        bar.innerHTML = "";
        legend.innerHTML = `<div class="analytics-legend-item">単語がまだ登録されていません</div>`;
        return;
      }

      const order = [1, 2, 3, 4, 5, 0]; // 仕様#45と同じ並び順
      bar.innerHTML = order.map(lv => {
        const pct = (counts[lv] / total) * 100;
        return pct > 0 ? `<div class="analytics-bar-seg" style="width:${pct}%;background:${YNQ.LEVEL_COLORS[lv]}" title="Level${lv}: ${pct.toFixed(1)}%"></div>` : "";
      }).join("");
      legend.innerHTML = order.map(lv => {
        const pct = (counts[lv] / total) * 100;
        return `
          <div class="analytics-legend-item">
            <span class="legend-dot" style="background:${YNQ.LEVEL_COLORS[lv]}"></span>
            Level${lv}: ${pct.toFixed(1)}% | ${counts[lv]}単語
          </div>`;
      }).join("");
    } catch (err) {
      console.error("[account:loadLevelAggregate]", err);
      bar.innerHTML = "";
      legend.innerHTML = `<div class="analytics-legend-item">集計の取得に失敗しました</div>`;
    }
  }

  /* ---------- テスト実施記録(直近20件) ---------- */
  const FORMAT_LABEL = { flashcard: "単語カード", choice4: "4択問題", typed: "入力記述" };

  function formatDateTime(d) {
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  async function loadTestHistory() {
    const tbody = document.getElementById("account-test-history-body");
    try {
      const snap = await YNQ.db.collection("users").doc(YNQ.currentUser.uid)
        .collection("testResults").orderBy("createdAt", "desc").limit(20).get();

      if (snap.empty) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted);padding:20px;">まだテストの実施記録がありません</td></tr>`;
        return;
      }

      tbody.innerHTML = snap.docs.map(d => {
        const r = d.data();
        const date = (r.createdAt && r.createdAt.toDate) ? formatDateTime(r.createdAt.toDate()) : "-";
        return `
          <tr>
            <td>${YNQ.escapeHtml(date)}</td>
            <td class="col-word">${YNQ.escapeHtml(r.bookName || "-")}</td>
            <td>${YNQ.escapeHtml(FORMAT_LABEL[r.format] || r.format || "-")}</td>
            <td>${r.accuracyPct}% (${r.correctCount}/${r.total})</td>
          </tr>`;
      }).join("");
    } catch (err) {
      console.error("[account:loadTestHistory]", err);
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--color-danger);padding:20px;">読み込みに失敗しました</td></tr>`;
    }
  }

  return { init };
})();
