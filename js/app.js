/* ============================================================
   Y-NoteQ app.js
   Firebase設定 / ログイン・新規登録 / テーマ切替 / ヘッダー操作 / タブ読込
   Phase 1: 骨格 + ログイン/登録 + ヘッダー/フッター
   ============================================================ */

/* ----------------------------------------------------------
   0. 設定値・定数
   ---------------------------------------------------------- */

// Firebase プロジェクト設定(ユーザー提供の値)
const firebaseConfig = {
  apiKey: "AIzaSyC4X91yGIZkHxj3xPOAnc_R5uuCVw0iwtI",
  authDomain: "y-noteq-a.firebaseapp.com",
  databaseURL: "https://y-noteq-a-default-rtdb.firebaseio.com",
  projectId: "y-noteq-a",
  storageBucket: "y-noteq-a.firebasestorage.app",
  messagingSenderId: "500955780666",
  appId: "1:500955780666:web:88ba469096c53525590703",
  measurementId: "G-SWPW6NYML4"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// 招待コードによる新規登録制限のON/OFFフラグ。
// 将来「コードなしで新規登録できる」ようにする際は false にするだけでよい
// (①招待コードのステップが自動的にスキップされる)。
const REQUIRE_INVITE_CODE = true;

// 暗記度(Level)の表示色。仕様で固定されている値。
const LEVEL_COLORS = {
  0: "#cccccc",
  1: "#2a8cef",
  2: "#72ef2a",
  3: "#e9fa19",
  4: "#fa6c19",
  5: "#ff4e4d"
};

// アカウントアイコンの自動色割り当て用パレット(ユーザーごとにハッシュ値で固定色を割当)
const AVATAR_COLORS = ["#2a8cef", "#72ef2a", "#fa6c19", "#ff4e4d", "#a855f7", "#0ea5e9", "#f97316", "#22c55e"];

// 「使い方」モーダルの内容。[見出し, 説明] の形で追加していけば自動反映される。
// ▼▼ ここから先はユーザーが自由に編集してよい(内容追加/変更用コメント) ▼▼
const HOWTO_CONTENT = [
  { title: "フォルダーを作る", body: "ホーム画面の「新規追加」から、単語帳をまとめるフォルダーを作成できます。" },
  { title: "単語帳を編集する", body: "フォルダーを開き、単語帳の「編集」タブから単語の追加・修正・削除ができます。" },
  { title: "テストで暗記度を上げる", body: "「テスト」タブから小テストを開始すると、正誤に応じて暗記度(Level)が変動します。" }
];
// ▲▲ ここまでユーザー編集エリア ▲▲

// 「パッチノート」の内容。新しいバージョンを配列の先頭に追加していく。
// index 0 が最新版として常に開いた状態で表示され、それ以外は「過去のアップデート」に格納される。
// ▼▼ ここから先はユーザーが自由に編集してよい(バージョン追加用コメント) ▼▼
const PATCH_NOTES = [
  {
    version: "0.1.0",
    date: "2026/09/11",
    items: ["ログイン・新規登録機能を追加", "ヘッダー・フッターの骨格を追加", "ライト/ダークモード切替に対応"]
  }
];
// ▲▲ ここまでユーザー編集エリア ▲▲


/* ----------------------------------------------------------
   1. 汎用ユーティリティ
   ---------------------------------------------------------- */

// 画面下部にトースト通知を一定時間表示する
function showToast(message, duration = 2600) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toast.hidden = true; }, duration);
}

// モーダル(#id)を表示する
function openModal(id) {
  document.getElementById(id).hidden = false;
}
// モーダル(#id)を閉じる
function closeModal(id) {
  document.getElementById(id).hidden = true;
}

// 文字列から安定したハッシュ値を作る(アイコン色の自動割当に使用)
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}


/* ----------------------------------------------------------
   2. テーマ(ライト/ダークモード)管理
   - 既定は「システム設定に自動追従」(auto)
   - ユーザーがボタンで切り替えた場合のみ localStorage に固定保存する
   ---------------------------------------------------------- */

function applyTheme(theme) {
  // theme: "light" | "dark" | "auto"
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function initTheme() {
  const saved = localStorage.getItem("ynoteq-theme") || "auto";
  applyTheme(saved);
}

// ライト/ダークを手動でトグルする(現在の見た目を見て反転させる)
function toggleTheme() {
  const isDarkNow = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const current = document.documentElement.getAttribute("data-theme") || (isDarkNow ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("ynoteq-theme", next);
  applyTheme(next);
}


/* ----------------------------------------------------------
   3. 「使い方」「パッチノート」モーダルの中身を描画
   ---------------------------------------------------------- */

function renderHowto() {
  const wrap = document.getElementById("howto-list");
  wrap.innerHTML = HOWTO_CONTENT.map(item => `
    <div class="howto-item">
      <h3>・${item.title}</h3>
      <p>${item.body}</p>
    </div>
  `).join("");
}

function renderPatchNotes() {
  const latestWrap = document.getElementById("patch-latest");
  const historyWrap = document.getElementById("patch-history");

  const renderEntry = (note) => `
    <div class="patch-entry">
      <div class="patch-meta">Ver: ${note.version}　更新日時: ${note.date}</div>
      <div>内容::</div>
      <ul>${note.items.map(i => `<li>${i}</li>`).join("")}</ul>
    </div>
  `;

  latestWrap.innerHTML = PATCH_NOTES.length ? renderEntry(PATCH_NOTES[0]) : "<p>まだ更新履歴がありません。</p>";
  historyWrap.innerHTML = PATCH_NOTES.slice(1).map(renderEntry).join("") || "<p>過去の更新はありません。</p>";
}


/* ----------------------------------------------------------
   4. ログイン画面 ⇔ 新規登録画面の切り替え
   ---------------------------------------------------------- */

function showScreen(name) {
  document.getElementById("screen-login").hidden = name !== "login";
  document.getElementById("screen-register").hidden = name !== "register";
  if (name === "register") resetRegisterFlow();
}


/* ----------------------------------------------------------
   5. 新規登録: ①招待コード → ②メールアドレス → ③パスワード
   ---------------------------------------------------------- */

// REQUIRE_INVITE_CODE が false の場合、招待コードのステップを除外した手順にする
const REGISTER_STEPS = REQUIRE_INVITE_CODE ? ["invite", "email", "password"] : ["email", "password"];
let registerStepIndex = 0;
let registerData = { invite: "", email: "", password: "" };

function resetRegisterFlow() {
  registerStepIndex = 0;
  registerData = { invite: "", email: "", password: "" };
  document.getElementById("reg-invite").value = "";
  document.getElementById("reg-email").value = "";
  document.getElementById("reg-password").value = "";
  document.getElementById("reg-password2").value = "";
  clearRegisterErrors();
  renderRegisterStep();
}

function clearRegisterErrors() {
  ["reg-invite-error", "reg-email-error", "reg-password-error", "reg-password2-error"]
    .forEach(id => { document.getElementById(id).textContent = ""; });
}

function renderRegisterStep() {
  const stepName = REGISTER_STEPS[registerStepIndex];

  // 招待コード不要設定の場合は該当ブロック自体を非表示にする
  const inviteBlock = document.querySelector('.register-step[data-step="invite"]');
  const inviteDot = document.querySelector('.step-dot[data-step="invite"]');
  if (!REQUIRE_INVITE_CODE) {
    inviteBlock.style.display = "none";
    inviteDot.style.display = "none";
  }

  document.querySelectorAll(".register-step").forEach(el => {
    el.classList.toggle("active", el.dataset.step === stepName);
  });
  document.querySelectorAll(".step-dot").forEach(el => {
    const idx = REGISTER_STEPS.indexOf(el.dataset.step);
    el.classList.toggle("active", el.dataset.step === stepName);
    el.classList.toggle("done", idx > -1 && idx < registerStepIndex);
  });
}

function goToNextRegisterStep() {
  registerStepIndex = Math.min(registerStepIndex + 1, REGISTER_STEPS.length - 1);
  renderRegisterStep();
}
function goToPrevRegisterStep() {
  registerStepIndex = Math.max(registerStepIndex - 1, 0);
  renderRegisterStep();
}

// ①招待コードをFirestoreに照合する(inviteCodes コレクション / ドキュメントID = コード)
async function verifyInviteCode(code) {
  const errorEl = document.getElementById("reg-invite-error");
  if (!/^\d{6}$/.test(code)) {
    errorEl.textContent = "招待コードは6桁の数字で入力してください。";
    return false;
  }
  try {
    const doc = await db.collection("inviteCodes").doc(code).get();
    if (!doc.exists || doc.data().active === false || doc.data().used === true) {
      errorEl.textContent = "招待コードが正しくないか、既に使用されています。";
      return false;
    }
    errorEl.textContent = "";
    return true;
  } catch (err) {
    errorEl.textContent = "招待コードの確認に失敗しました。通信環境をご確認ください。";
    console.error("[verifyInviteCode]", err);
    return false;
  }
}

// ②メールアドレスの簡易バリデーション(@を含むかどうか)
function validateEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+$/.test(email);
}

// ③パスワードのバリデーション(8文字以上・確認用と一致)
function validatePasswords(pw1, pw2) {
  const errors = { pw1: "", pw2: "" };
  if (pw1.length < 8) errors.pw1 = "パスワードは8文字以上で入力してください。";
  if (pw2 !== pw1) errors.pw2 = "確認用パスワードが一致しません。";
  return errors;
}

// Firebase Authenticationにユーザーを作成し、Firestoreにプロフィールを保存する
async function registerUser() {
  const submitBtn = document.getElementById("btn-register-submit");
  submitBtn.disabled = true;
  try {
    const cred = await auth.createUserWithEmailAndPassword(registerData.email, registerData.password);
    const uid = cred.user.uid;
    const avatarColor = AVATAR_COLORS[hashString(uid) % AVATAR_COLORS.length];

    // ユーザープロフィールをFirestoreに保存
    await db.collection("users").doc(uid).set({
      email: registerData.email,
      username: registerData.email.split("@")[0], // 暫定のユーザーネーム(後にプロフィール画面で変更可能にする想定)
      avatarColor,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 招待コードを使用済みにする
    if (REQUIRE_INVITE_CODE && registerData.invite) {
      await db.collection("inviteCodes").doc(registerData.invite).set({
        used: true,
        usedBy: uid,
        usedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    await auth.signOut(); // 登録直後はログイン画面に戻す仕様のため一旦サインアウト
    showScreen("login");
    showToast("登録が完了しました");
  } catch (err) {
    console.error("[registerUser]", err);
    const errorEl = document.getElementById("reg-password2-error");
    errorEl.textContent = translateFirebaseError(err);
  } finally {
    submitBtn.disabled = false;
  }
}

// Firebaseのエラーコードを日本語メッセージに変換する
function translateFirebaseError(err) {
  const map = {
    "auth/email-already-in-use": "このメールアドレスは既に登録されています。",
    "auth/invalid-email": "メールアドレスの形式が正しくありません。",
    "auth/weak-password": "パスワードが脆弱です。8文字以上で設定してください。",
    "auth/user-not-found": "アカウントが見つかりません。",
    "auth/wrong-password": "メールアドレスまたはパスワードが正しくありません。",
    "auth/invalid-credential": "メールアドレスまたはパスワードが正しくありません。",
    "auth/too-many-requests": "試行回数が多すぎます。しばらくしてから再度お試しください。"
  };
  return map[err.code] || "エラーが発生しました。時間をおいて再度お試しください。";
}


/* ----------------------------------------------------------
   6. ログイン処理
   ---------------------------------------------------------- */

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  document.getElementById("login-email-error").textContent = "";
  document.getElementById("login-password-error").textContent = "";

  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  try {
    await auth.signInWithEmailAndPassword(email, password);
    // ログイン成功後の画面切り替えは onAuthStateChanged 側で行う
  } catch (err) {
    console.error("[handleLogin]", err);
    document.getElementById("login-password-error").textContent = translateFirebaseError(err);
  } finally {
    btn.disabled = false;
  }
}


/* ----------------------------------------------------------
   7. アプリ本体(ヘッダー等)のセットアップ
   ---------------------------------------------------------- */

// ログイン中ユーザーの情報をヘッダーのアカウントアイコンに反映する
async function loadAccountBadge(user) {
  const badge = document.getElementById("btn-account");
  let username = user.email ? user.email[0].toUpperCase() : "?";
  let color = AVATAR_COLORS[hashString(user.uid) % AVATAR_COLORS.length];

  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (doc.exists) {
      const data = doc.data();
      if (data.username) username = data.username[0].toUpperCase();
      if (data.avatarColor) color = data.avatarColor;
    }
  } catch (err) {
    console.error("[loadAccountBadge]", err);
  }

  badge.textContent = username;
  badge.style.background = color;
}

// タブの中身(tabs/*.html)を読み込んで #tab-content-area に差し込む
// ※ file:// で直接開くとブラウザのセキュリティ制限でfetchが失敗するため、
//   必ずローカルサーバー(Live Server / firebase serve 等)を経由して開いてください。
async function loadTab(tabName) {
  const area = document.getElementById("tab-content-area");
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  // 「フォルダー」タブ以外の時だけ単語帳名エリアを表示する(中身はPhase2で設定)
  document.getElementById("header-booktitle").hidden = (tabName === "home");

  try {
    const res = await fetch(`tabs/${tabName}.html`);
    if (!res.ok) throw new Error(`tabs/${tabName}.html が見つかりません`);
    area.innerHTML = await res.text();
  } catch (err) {
    console.error("[loadTab]", err);
    area.innerHTML = `<div class="placeholder-card"><i class="fa-solid fa-triangle-exclamation"></i><p>このタブは準備中です(Phase 2以降で実装予定)。</p></div>`;
  }
}

function setupHeaderInteractions() {
  // ロゴクリックでホーム(フォルダータブ)へ
  document.getElementById("btn-logo-home").addEventListener("click", () => loadTab("home"));

  // 戻るボタン(簡易実装。詳細な内部履歴管理はPhase2以降で拡張予定)
  document.getElementById("btn-back").addEventListener("click", () => history.back());
  document.getElementById("mbtn-back").addEventListener("click", () => history.back());

  // テーマ切替
  document.getElementById("btn-theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("mbtn-theme").addEventListener("click", toggleTheme);

  // 使い方 / パッチノート モーダル
  document.getElementById("btn-open-howto").addEventListener("click", () => openModal("modal-howto"));
  document.getElementById("mbtn-howto").addEventListener("click", () => { closeMobileMenu(); openModal("modal-howto"); });
  document.getElementById("btn-close-howto").addEventListener("click", () => closeModal("modal-howto"));

  document.getElementById("btn-open-patchnotes").addEventListener("click", () => openModal("modal-patchnotes"));
  document.getElementById("mbtn-patchnotes").addEventListener("click", () => { closeMobileMenu(); openModal("modal-patchnotes"); });
  document.getElementById("btn-close-patchnotes").addEventListener("click", () => closeModal("modal-patchnotes"));
  document.getElementById("btn-toggle-history").addEventListener("click", (e) => {
    const hist = document.getElementById("patch-history");
    hist.hidden = !hist.hidden;
    e.currentTarget.innerHTML = hist.hidden
      ? '過去のアップデートを見る <i class="fa-solid fa-chevron-down"></i>'
      : '閉じる <i class="fa-solid fa-chevron-up"></i>';
  });

  // 音量ポップオーバー
  document.getElementById("btn-volume").addEventListener("click", (e) => {
    e.stopPropagation();
    togglePopover("popover-volume");
  });

  // アカウントメニュー
  document.getElementById("btn-account").addEventListener("click", (e) => {
    e.stopPropagation();
    togglePopover("popover-account");
  });
  document.getElementById("menu-logout").addEventListener("click", () => auth.signOut());
  document.getElementById("menu-profile").addEventListener("click", () => {
    closeAllPopovers();
    showToast("プロフィール機能は準備中です");
  });
  document.getElementById("menu-bugreport").addEventListener("click", () => {
    closeAllPopovers();
    showToast("バグ報告機能は準備中です");
  });

  // ポップオーバーの外側クリックで閉じる
  document.addEventListener("click", closeAllPopovers);

  // ハンバーガーメニュー(モバイル)
  document.getElementById("btn-hamburger").addEventListener("click", () => { document.getElementById("mobile-menu").hidden = false; });
  document.getElementById("btn-mobile-menu-close").addEventListener("click", closeMobileMenu);
  document.getElementById("mobile-menu").addEventListener("click", (e) => {
    if (e.target.id === "mobile-menu") closeMobileMenu();
  });

  // タブバーのボタン
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => loadTab(btn.dataset.tab));
  });

  // 汎用確認ダイアログのキャンセル
  document.getElementById("btn-confirm-cancel").addEventListener("click", () => closeModal("modal-confirm"));
}

function togglePopover(id) {
  const el = document.getElementById(id);
  const wasHidden = el.hidden;
  closeAllPopovers();
  el.hidden = !wasHidden;
}
function closeAllPopovers() {
  document.getElementById("popover-volume").hidden = true;
  document.getElementById("popover-account").hidden = true;
}
function closeMobileMenu() {
  document.getElementById("mobile-menu").hidden = true;
}

// 汎用の削除確認ダイアログ(Phase2以降のフォルダー/単語帳削除などから呼び出す想定)
function confirmDialog(message, onConfirm) {
  document.getElementById("confirm-message").textContent = message;
  openModal("modal-confirm");
  const okBtn = document.getElementById("btn-confirm-ok");
  const newOkBtn = okBtn.cloneNode(true); // 直前のリスナーを消すため差し替える
  okBtn.parentNode.replaceChild(newOkBtn, okBtn);
  newOkBtn.addEventListener("click", () => { closeModal("modal-confirm"); onConfirm(); });
}


/* ----------------------------------------------------------
   8. 認証状態の監視(ログイン/ログアウトで画面を切り替える)
   ---------------------------------------------------------- */

auth.onAuthStateChanged((user) => {
  if (user) {
    document.getElementById("screen-login").hidden = true;
    document.getElementById("screen-register").hidden = true;
    document.getElementById("app-shell").hidden = false;
    document.getElementById("tab-bar").hidden = false;
    loadAccountBadge(user);
    loadTab("home");
  } else {
    document.getElementById("app-shell").hidden = true;
    document.getElementById("tab-bar").hidden = true;
    showScreen("login");
  }
});


/* ----------------------------------------------------------
   9. 初期化
   ---------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  renderHowto();
  renderPatchNotes();
  setupHeaderInteractions();

  // ログイン
  document.getElementById("form-login").addEventListener("submit", handleLogin);
  document.getElementById("btn-go-register").addEventListener("click", () => showScreen("register"));
  document.getElementById("btn-go-login").addEventListener("click", () => showScreen("login"));

  // 新規登録: ①招待コード
  document.getElementById("btn-invite-next").addEventListener("click", async () => {
    const code = document.getElementById("reg-invite").value.trim();
    const ok = await verifyInviteCode(code);
    if (ok) {
      registerData.invite = code;
      goToNextRegisterStep();
    }
  });

  // 新規登録: ②メールアドレス
  document.getElementById("btn-email-next").addEventListener("click", () => {
    const email = document.getElementById("reg-email").value.trim();
    const errorEl = document.getElementById("reg-email-error");
    if (!validateEmailFormat(email)) {
      errorEl.textContent = "メールアドレスの形式が正しくありません(@が必要です)。";
      return;
    }
    errorEl.textContent = "";
    registerData.email = email;
    goToNextRegisterStep();
  });
  document.getElementById("btn-email-back").addEventListener("click", goToPrevRegisterStep);

  // 新規登録: ③パスワード
  document.getElementById("btn-password-back").addEventListener("click", goToPrevRegisterStep);
  document.getElementById("btn-register-submit").addEventListener("click", () => {
    const pw1 = document.getElementById("reg-password").value;
    const pw2 = document.getElementById("reg-password2").value;
    const errors = validatePasswords(pw1, pw2);
    document.getElementById("reg-password-error").textContent = errors.pw1;
    document.getElementById("reg-password2-error").textContent = errors.pw2;
    if (errors.pw1 || errors.pw2) return;

    registerData.password = pw1;
    registerUser();
  });

  // 新規登録フローの初期表示を整える(招待コード不要設定の反映など)
  resetRegisterFlow();
});
