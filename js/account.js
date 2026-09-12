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
  let avatarState = { color: AVATAR_COLOR_SWATCHES[0], text: "", number: "" };
  let currentUsername = "";

  function init() {
    loadProfile();
    loadRankSummary(); // 仕様追加2026/09/12 No.4
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
      // 数字も入力できるようにする(仕様修正2026/09/12 No.2-1)。文字種の制限はせず先頭2文字までに丸める
      avatarState.text = e.target.value.toUpperCase().slice(0, 2);
      updateAvatarPreview();
    });
    document.getElementById("account-avatar-number-input").addEventListener("input", (e) => {
      // 団体管理用の通し番号(4桁の数字のみ)。数字以外は除去する
      avatarState.number = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
      e.target.value = avatarState.number;
      updateAvatarPreview();
    });
    document.getElementById("account-avatar-custom-color").addEventListener("input", (e) => {
      avatarState.color = e.target.value;
      renderAvatarColorSwatches();
      updateAvatarPreview();
    });

    // 仕様追加2026/09/12 No.4-R: 過去のランク履歴の開閉
    document.getElementById("btn-toggle-rank-history").addEventListener("click", (e) => {
      const hist = document.getElementById("rank-history");
      hist.hidden = !hist.hidden;
      e.currentTarget.innerHTML = hist.hidden
        ? '過去のランク履歴を見る <i class="fa-solid fa-chevron-down"></i>'
        : '閉じる <i class="fa-solid fa-chevron-up"></i>';
      if (!hist.hidden) loadRankHistory();
    });
  }

  /* ---------- ランク(仕様追加2026/09/12 No.4) ---------- */
  async function loadRankSummary() {
    const nameEl = document.getElementById("rank-summary-name");
    const imgEl = document.getElementById("rank-badge-img");
    const barWrap = document.getElementById("rank-progress-bar");
    const barFill = document.getElementById("rank-progress-fill");
    const pointsEl = document.getElementById("rank-summary-points");

    try {
      const doc = await YNQ.db.collection("users").doc(YNQ.currentUser.uid).get();
      const data = doc.exists ? doc.data() : {};
      const rank = data.rank || { tier: "Unranked", division: null, points: 0 };
      const qualifyingTestCount = data.qualifyingTestCount || 0;

      imgEl.src = YNQ_RANK.rankBadgeImagePath(rank);
      // 仕様追加2026/09/12 No.5-6: 現在の期間ラベル(例: 26-Sum)をランク名の横に表示
      nameEl.innerHTML = `${YNQ.escapeHtml(YNQ_RANK.rankLabel(rank))} <span class="rank-period-badge">${YNQ_RANK.seasonLabel(new Date())}</span>`;

      if (rank.tier === "Unranked") {
        barWrap.hidden = true;
        pointsEl.textContent = `テスト(単語カードを除く)を${qualifyingTestCount}/5回実施しました。5回でIron Ⅰが解放されます。`;
        return;
      }

      const max = YNQ_RANK.tierMaxPoints(rank.tier);
      const band = YNQ_RANK.tierBand(rank.tier) === "light" ? "ライトランク帯" : "高ランク帯";
      if (max === null) {
        // Veritasは上限なし(仕様: 200pt maxとせず上限を設定しない)
        barWrap.hidden = true;
        pointsEl.textContent = `${rank.points.toFixed(1)}pt(${band}・上限なし)`;
      } else {
        barWrap.hidden = false;
        barFill.style.width = `${Math.max(0, Math.min(100, (rank.points / max) * 100))}%`;
        pointsEl.textContent = `${rank.points.toFixed(1)} / ${max}pt(${band})`;
      }
    } catch (err) {
      console.error("[account:loadRankSummary]", err);
      nameEl.textContent = "読み込みに失敗しました";
    }
  }

  // 仕様R: 奇数月末デモーション(仕様Q)で降格した際の、期間中の最高ランクと到達日時の履歴
  // 仕様修正2026/09/12 No.5-7: 同じ期間内はランク推移(昇格するたび)を複数件表示し、
  // 期間が終了したものはその期間の最高ランク1件だけに集約されている(集約自体はapp.js側で行う)。
  async function loadRankHistory() {
    const tbody = document.getElementById("rank-history-body");
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--color-text-muted);padding:16px;">読み込み中...</td></tr>`;
    try {
      const snap = await YNQ.db.collection("users").doc(YNQ.currentUser.uid)
        .collection("rankHistory").orderBy("achievedAt", "desc").limit(30).get();
      if (snap.empty) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--color-text-muted);padding:16px;">まだ履歴がありません</td></tr>`;
        return;
      }
      tbody.innerHTML = snap.docs.map(d => {
        const r = d.data();
        const achievedDate = (r.achievedAt && r.achievedAt.toDate) ? r.achievedAt.toDate() : null;
        const achieved = achievedDate ? formatDateTime(achievedDate) : "-";
        const period = r.period || (achievedDate ? YNQ_RANK.seasonLabel(achievedDate) : "-");
        return `
          <tr>
            <td>${YNQ.escapeHtml(period)}</td>
            <td>${YNQ.escapeHtml(YNQ_RANK.rankLabel(r.rank))}</td>
            <td>${YNQ.escapeHtml(achieved)}</td>
          </tr>`;
      }).join("");
    } catch (err) {
      console.error("[account:loadRankHistory]", err);
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--color-danger);padding:16px;">読み込みに失敗しました</td></tr>`;
    }
  }

  /* ---------- プロフィール(ユーザーネーム・アイコン) ---------- */
  async function loadProfile() {
    const user = YNQ.currentUser;
    document.getElementById("account-email").textContent = user.email || "";

    let username = user.email ? user.email.split("@")[0] : "不明なユーザー";
    let color = YNQ.AVATAR_COLORS[YNQ.hashString(user.uid) % YNQ.AVATAR_COLORS.length];
    let avatarText = "";
    let avatarNumber = "";

    try {
      const doc = await YNQ.db.collection("users").doc(user.uid).get();
      if (doc.exists) {
        const data = doc.data();
        if (data.username) username = data.username;
        if (data.avatarColor) color = data.avatarColor;
        if (data.avatarText) avatarText = data.avatarText;
        if (data.avatarNumber) avatarNumber = data.avatarNumber;
      }
    } catch (err) {
      console.error("[account:loadProfile]", err);
    }

    currentUsername = username;
    document.getElementById("account-username-input").value = username;

    avatarState = { color, text: avatarText, number: avatarNumber };
    document.getElementById("account-avatar-text-input").value = avatarText;
    document.getElementById("account-avatar-number-input").value = avatarNumber;
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

  // 表示文字が未設定の場合はユーザーネームの頭文字をプレビュー表示する(実際の保存値は空のまま)。
  // 通し番号が4桁揃っている場合は「番号(上段)+表示文字(下段)」の2段表示にする(仕様修正2026/09/12 No.2-1)。
  function updateAvatarPreview() {
    const avatarEl = document.getElementById("account-avatar-large");
    YNQ.renderAvatarContent(avatarEl, { number: avatarState.number, text: avatarState.text, username: currentUsername });
    avatarEl.style.background = avatarState.color;
  }

  async function saveAvatar() {
    const btn = document.getElementById("btn-save-avatar");
    btn.disabled = true;
    try {
      await YNQ.db.collection("users").doc(YNQ.currentUser.uid).set({
        avatarColor: avatarState.color,
        avatarText: avatarState.text,
        avatarNumber: avatarState.number
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
            <span class="analytics-legend-text">Level${lv}: ${pct.toFixed(1)}%<br>${counts[lv]}単語</span>
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
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);padding:20px;">まだテストの実施記録がありません</td></tr>`;
        return;
      }

      tbody.innerHTML = snap.docs.map(d => {
        const r = d.data();
        const date = (r.createdAt && r.createdAt.toDate) ? formatDateTime(r.createdAt.toDate()) : "-";
        // 仕様S: ポイント履歴もここから見られるように(ランクなし期間のテストはnullのため「-」表示)
        const pointsCell = (r.pointsEarned === null || r.pointsEarned === undefined)
          ? "-"
          : `${r.pointsEarned >= 0 ? "+" : ""}${r.pointsEarned.toFixed(1)}pt`; // 仕様修正2026/09/12 No.5-5

        // 仕様修正2026/09/12 No.5-9: ログインボーナスの記録は専用の行として表示する
        if (r.type === "login") {
          return `
            <tr>
              <td>${YNQ.escapeHtml(date)}</td>
              <td class="col-word" colspan="3"><i class="fa-solid fa-calendar-check"></i> ログインボーナス</td>
              <td>${pointsCell}</td>
            </tr>`;
        }
        return `
          <tr>
            <td>${YNQ.escapeHtml(date)}</td>
            <td class="col-word">${YNQ.escapeHtml(r.bookName || "-")}</td>
            <td>${YNQ.escapeHtml(FORMAT_LABEL[r.format] || r.format || "-")}</td>
            <td>${r.accuracyPct}% (${r.correctCount}/${r.total})</td>
            <td>${pointsCell}</td>
          </tr>`;
      }).join("");
    } catch (err) {
      console.error("[account:loadTestHistory]", err);
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-danger);padding:20px;">読み込みに失敗しました</td></tr>`;
    }
  }

  return { init };
})();
