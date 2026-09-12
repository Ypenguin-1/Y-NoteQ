/* ============================================================
   Y-NoteQ account.js
   「アカウント」タブ(tabs/account.html)の描画とデータ取得
   ・ユーザーネーム / アイコン
   ・個人Level(全フォルダー・全単語帳を横断した暗記度の集計)
   ・テスト実施記録(直近20件、仕様#82)
   ============================================================ */
window.AccountTab = (function () {

  // アイコン背景色の選択肢(仕様修正2026/09/12 No.5)
  const AVATAR_COLOR_SWATCHES = ["#2a8cef", "#72ef2a", "#fa6c19", "#ff4e4d", "#a855f7", "#0ea5e9", "#f97316", "#22c55e", "#F2CF00"];
  // 編集中のアイコン設定(保存ボタン押下時にまとめてFirestoreへ反映する)
  let avatarState = { color: AVATAR_COLOR_SWATCHES[0], text: "" };
  let currentUsername = "";

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

    document.getElementById("btn-save-avatar").addEventListener("click", saveAvatar);
    document.getElementById("account-avatar-text-input").addEventListener("input", (e) => {
      avatarState.text = e.target.value.toUpperCase().slice(0, 2);
      updateAvatarPreview();
    });
    document.getElementById("account-avatar-custom-color").addEventListener("input", (e) => {
      avatarState.color = e.target.value;
      renderAvatarColorSwatches();
      updateAvatarPreview();
    });
  }

  /* ---------- プロフィール(ユーザーネーム・アイコン) ---------- */
  async function loadProfile() {
    const user = YNQ.currentUser;
    document.getElementById("account-email").textContent = user.email || "";

    let username = user.email ? user.email.split("@")[0] : "不明なユーザー";
    let color = YNQ.AVATAR_COLORS[YNQ.hashString(user.uid) % YNQ.AVATAR_COLORS.length];
    let avatarText = "";

    try {
      const doc = await YNQ.db.collection("users").doc(user.uid).get();
      if (doc.exists) {
        const data = doc.data();
        if (data.username) username = data.username;
        if (data.avatarColor) color = data.avatarColor;
        if (data.avatarText) avatarText = data.avatarText;
      }
    } catch (err) {
      console.error("[account:loadProfile]", err);
    }

    currentUsername = username;
    document.getElementById("account-username-input").value = username;

    avatarState = { color, text: avatarText };
    document.getElementById("account-avatar-text-input").value = avatarText;
    document.getElementById("account-avatar-custom-color").value = color;
    renderAvatarColorSwatches();
    updateAvatarPreview();
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
      currentUsername = newName;
      updateAvatarPreview();
      YNQ.refreshAccountBadge();
      YNQ.showToast("ユーザーネームを更新しました");
    } catch (err) {
      console.error("[account:saveUsername]", err);
      YNQ.showToast("更新に失敗しました");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- アイコン(背景色・表示文字)のカスタマイズ ---------- */
  function renderAvatarColorSwatches() {
    const wrap = document.getElementById("account-avatar-colors");
    wrap.innerHTML = AVATAR_COLOR_SWATCHES.map(c => `
      <button type="button" class="color-swatch${c === avatarState.color ? " selected" : ""}" style="background:${c}" data-color="${c}"></button>
    `).join("");
    wrap.querySelectorAll(".color-swatch").forEach(btn => {
      btn.addEventListener("click", () => {
        avatarState.color = btn.dataset.color;
        document.getElementById("account-avatar-custom-color").value = avatarState.color;
        wrap.querySelectorAll(".color-swatch").forEach(b => b.classList.toggle("selected", b === btn));
        updateAvatarPreview();
      });
    });
  }

  // 表示文字が未設定の場合はユーザーネームの頭文字をプレビュー表示する(実際の保存値は空のまま)
  function updateAvatarPreview() {
    const displayText = avatarState.text || (currentUsername[0] ? currentUsername[0].toUpperCase() : "?");
    const avatarEl = document.getElementById("account-avatar-large");
    avatarEl.textContent = displayText;
    avatarEl.style.background = avatarState.color;
  }

  async function saveAvatar() {
    const btn = document.getElementById("btn-save-avatar");
    btn.disabled = true;
    try {
      await YNQ.db.collection("users").doc(YNQ.currentUser.uid).set({
        avatarColor: avatarState.color,
        avatarText: avatarState.text
      }, { merge: true });
      YNQ.refreshAccountBadge();
      YNQ.showToast("アイコンを更新しました");
    } catch (err) {
      console.error("[account:saveAvatar]", err);
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
