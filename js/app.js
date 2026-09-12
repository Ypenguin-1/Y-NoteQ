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

// 暗記度(Level)の表示色。仕様で固定されている値(仕様修正2026/09/12 No.2)。
const LEVEL_COLORS = {
  0: "#A6A6A6",
  1: "#1781F5",
  2: "#04D213",
  3: "#E4F600",
  4: "#FF9B09",
  5: "#ff4e4d"
};

// アカウントアイコンの自動色割り当て用パレット(ユーザーごとにハッシュ値で固定色を割当)
const AVATAR_COLORS = ["#2a8cef", "#72ef2a", "#fa6c19", "#ff4e4d", "#a855f7", "#0ea5e9", "#f97316", "#22c55e"];

// 「使い方」モーダルの内容。[見出し, 説明] の形で追加していけば自動反映される。
// ▼▼ ここから先はユーザーが自由に編集してよい(内容追加/変更用コメント) ▼▼
const HOWTO_CONTENT = [
  { title: "フォルダーを作る", body: "ホーム画面の「新規追加」から、単語帳をまとめるフォルダーを作成できます。" },
  { title: "単語帳を編集する", body: "フォルダーを開き、単語帳の「編集」タブから単語の追加・修正・削除ができます。" },
  { title: "テストで暗記度を上げる", body: "「テスト」タブで出題範囲・出題形式(単語カード/4択/入力記述)などを設定して小テストを開始できます。Level採点をONにすると正誤に応じて暗記度(Level)が自動で変動します。" },
  { title: "単語を編集する", body: "「編集」タブから単語の直接追加、CSV/Excelファイルからの一括インポート、単語ごとの修正・リセット・削除、範囲指定での一括操作ができます。" },
  { title: "自分の記録を見る", body: "ヘッダーのアカウントアイコン→「プロフィール」から、全単語帳を合計した暗記度の状況や、直近のテスト実施記録を確認できます。" },
  { title: "ランク制度について", body: "テスト(単語カードを除く)を5回行うと「Iron Ⅰ」からランクが始まります。Iron〜Veritasの8階級・各3段階(Veritasのみ段階なし)で、テストの成績や毎日のログインでポイントを獲得して昇格していきます。アカウントタブの「ランク」欄でバッジ・ポイント状況・過去の履歴を確認できます。ポイントが0を下回るとランクが1段階下がりますが、0ptになった直後の1回だけは踏みとどまれます。また、Diamond以上のランクは奇数月末(1・3・5・7・9・11月の末日23:59)にランクが2段階下がるので、継続してプレーしましょう。" }
];
// ▲▲ ここまでユーザー編集エリア ▲▲

// 「パッチノート」の内容。新しいバージョンを配列の先頭に追加していく。
// index 0 が最新版として常に開いた状態で表示され、それ以外は「過去のアップデート」に格納される。
// ▼▼ ここから先はユーザーが自由に編集してよい(バージョン追加用コメント) ▼▼
const PATCH_NOTES = [
  {
    version: "0.5.0",
    date: "2026/09/12",
    items: [
      "ライトモードの背景色/文字色、ダークモードの文字色を変更",
      "暗記度(Level)の表示色を変更",
      "各所のボタンにホバー時のスタイルを追加",
      "「使い方」「パッチノート」ボタンにアイコンを追加",
      "アカウントアイコンの背景色・表示文字(最大2文字)をユーザーが変更できるように対応",
      "テスト開始後(実施画面・結果画面)からも、そのテストと同じ内容をPDF出力できるように対応",
      "PDF出力を常にライトモード(背景:白)で行うように統一",
      "「フォルダー一覧」を正方形のカード表示に変更し、フォルダー名・単語帳数・説明を表示。フォルダー/単語帳に説明(任意)を追加",
      "「単語一覧」タブをスマホ縦画面でも横スクロールなしで見られるように対応",
      "ダークモードで実施日カレンダーの表示が消える不具合を修正"
    ]
  },
  {
    version: "0.4.0",
    date: "2026/09/11",
    items: ["編集タブを追加(単語の追加/CSV・Excelインポート/修正/リセット/削除/一括操作)", "アカウントタブを追加(プロフィール・個人Level・テスト実施記録)"]
  },
  {
    version: "0.3.0",
    date: "2026/09/11",
    items: ["テストタブを追加(単語カード/4択問題/入力記述、制限時間、Level採点、結果のPDF出力)"]
  },
  {
    version: "0.2.0",
    date: "2026/09/11",
    items: ["フォルダー・単語帳の作成/編集/削除機能を追加", "単語一覧タブ(アナリティクス・検索フィルター・CSV/PDF出力)を追加"]
  },
  {
    version: "0.1.0",
    date: "2026/09/11",
    items: ["ログイン・新規登録機能を追加", "ヘッダー・フッターの骨格を追加", "ライト/ダークモード切替に対応"]
  }
];
// ▲▲ ここまでユーザー編集エリア ▲▲


/* ----------------------------------------------------------
   0.5 共有名前空間(YNQ)
   js/folders.js・js/wordlist.js など他のJSファイルから
   Firebaseのインスタンスや共通ユーティリティ、
   「今どのフォルダー/単語帳を開いているか」を参照できるようにする。
   ---------------------------------------------------------- */
const YNQ = {
  db, auth, LEVEL_COLORS, AVATAR_COLORS,
  currentUser: null,   // ログイン中ユーザー(firebase.User)
  currentFolder: null, // 開いているフォルダー { id, name, color }
  currentBook: null,   // 開いている単語帳 { id, name, color, folderId }
  // 以下は関数定義後(このファイルの後半)に中身が確定するが、
  // function宣言はホイスティングされるためここで参照しても問題ない
  showToast, openModal, closeModal, confirmDialog, escapeHtml, exportTableAsPdf,
  bindLevelToggleGroup, setLevelToggleValue, buildTestDateFields,
  pad4: (n) => String(n).padStart(4, "0"),
  hashString
};
window.YNQ = YNQ;


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

// ユーザー入力をHTMLに差し込む前にエスケープする(XSS対策)
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// 発音読み上げ(Web Speech API)。仕様追加2026/09/12 No.1:「単語一覧」「テスト」から共通で呼び出す。
// ヘッダーの音量ポップオーバーにある #vol-tts(0〜100)を音量(0〜1)に変換して使用する。
function speakText(text, lang) {
  if (!text) return;
  if (!("speechSynthesis" in window)) { showToast("この端末は読み上げに対応していません"); return; }
  const volSlider = document.getElementById("vol-tts");
  const volume = volSlider ? Number(volSlider.value) / 100 : 0.8;
  if (volume <= 0) { showToast("読み上げの音量が0になっています"); return; }
  window.speechSynthesis.cancel(); // 前の発話が残っていれば止めてから読み直す
  const utter = new SpeechSynthesisUtterance(text);
  utter.volume = volume;
  if (lang) utter.lang = lang;
  window.speechSynthesis.speak(utter);
}
YNQ.speakText = speakText;

/* ----------------------------------------------------------
   1.5 効果音(Web Audio APIで合成。音声ファイル不要)
   仕様追加2026/09/12 No.2:「テスト」の正解/不正解/結果画面遷移で使用する。
   ヘッダーの音量ポップオーバーにある #vol-se(0〜100)を音量(0〜1)に変換して使用する。
   ---------------------------------------------------------- */
let sfxAudioCtx = null;
function getSfxAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!sfxAudioCtx) sfxAudioCtx = new Ctx();
  if (sfxAudioCtx.state === "suspended") sfxAudioCtx.resume();
  return sfxAudioCtx;
}

// freqList を順番に短く鳴らす(単音〜数音の簡単なメロディ)
function playTone(freqList, { duration = 0.15, gap = 0.02, type = "sine" } = {}) {
  const volSlider = document.getElementById("vol-se");
  const volume = volSlider ? Number(volSlider.value) / 100 : 0.6;
  if (volume <= 0) return;
  const ctx = getSfxAudioContext();
  if (!ctx) return;
  let startTime = ctx.currentTime;
  freqList.forEach((freq) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(volume * 0.3, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
    startTime += duration + gap;
  });
}

function playCorrectSound() { playTone([880, 1318.51], { duration: 0.11, gap: 0.015 }); }
function playIncorrectSound() { playTone([220, 164.81], { duration: 0.18, type: "sawtooth" }); }
function playResultSound() { playTone([523.25, 659.25, 783.99, 1046.5], { duration: 0.13, gap: 0.02 }); }
YNQ.playCorrectSound = playCorrectSound;
YNQ.playIncorrectSound = playIncorrectSound;
YNQ.playResultSound = playResultSound;

// 単語を「実施(テストや手動でLevel変更)」した際に書き込む日付フィールドを組み立てる(仕様追加2026/09/12 No.3、
// 仕様修正2026/09/12 No.5-8)。
// ・更新日(lastTestDate) は毎回、今日の日付で更新する。
// ・初見日(firstSeenDate) は「Level0(未実施)から1になった」その瞬間だけ記録し、それ以外の遷移
//   (Level1→2、3→2 など)では一切変更しない。既に値がある場合も上書きしない。
function buildTestDateFields(levelBefore, existingFirstSeenDate, today) {
  const fields = { lastTestDate: today };
  if ((levelBefore || 0) === 0 && !existingFirstSeenDate) {
    fields.firstSeenDate = today;
  }
  return fields;
}

// 表(テーブル要素)をPDFとして書き出す共通処理(単語一覧・テストの各タブから利用)。
// jsPDFの標準フォントは日本語非対応のため、html2canvasで表を画像化してPDFに貼り付ける方式にしている。
// 仕様修正2026/09/12 No.7: 現在の画面がダークモードでも、PDFは常にライトモード(背景:白)で出力する。
// html2canvasのoncloneコールバックは画面外の複製ドキュメント内でのみ実行されるため、
// 実際に表示中の画面には一切影響を与えずに複製側だけを強制的にライトテーマ化できる。
async function exportTableAsPdf(tableEl, title, filename) {
  const canvas = await html2canvas(tableEl, {
    scale: 2,
    backgroundColor: "#ffffff",
    onclone: (clonedDoc) => {
      clonedDoc.documentElement.setAttribute("data-theme", "light");
    }
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const imgWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  doc.setFontSize(12);
  doc.text(title, margin, 10);

  const imgData = canvas.toDataURL("image/png");
  let heightLeft = imgHeight;
  let position = 16; // 1ページ目はタイトル分だけ下げる

  doc.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
  heightLeft -= (pageHeight - position);

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    doc.addPage();
    doc.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  doc.save(filename);
}

// Level(0〜5)を選ぶボタン群専用: 選択中のボタンをメインカラーではなく、
// そのLevel自身の色(LEVEL_COLORS)で塗る(仕様修正2026/09/12 #2)
function applyLevelToggleStyle(btn) {
  const lv = Number(btn.dataset.value);
  if (btn.classList.contains("active")) {
    btn.style.background = LEVEL_COLORS[lv];
    btn.style.borderColor = LEVEL_COLORS[lv];
    btn.style.color = "#1a1a1a";
  } else {
    btn.style.background = "";
    btn.style.borderColor = "";
    btn.style.color = "";
  }
}

// Level選択ボタン群の単一/複数選択を切り替える(押下ごとにapplyLevelToggleStyleで色反映)
function bindLevelToggleGroup(containerId, singleSelect, onChange) {
  const wrap = document.getElementById(containerId);
  wrap.querySelectorAll(".btn-toggle").forEach(btn => {
    applyLevelToggleStyle(btn); // HTML側に最初から active が付いている場合の初期反映
    btn.addEventListener("click", () => {
      if (singleSelect) {
        wrap.querySelectorAll(".btn-toggle").forEach(b => { b.classList.remove("active"); applyLevelToggleStyle(b); });
        btn.classList.add("active");
      } else {
        btn.classList.toggle("active");
      }
      applyLevelToggleStyle(btn);
      if (onChange) onChange();
    });
  });
}

// Level選択ボタン群の選択状態をJSから設定する(values は数値 または 数値の配列)
function setLevelToggleValue(containerId, values) {
  const arr = Array.isArray(values) ? values : [values];
  document.querySelectorAll(`#${containerId} .btn-toggle`).forEach(b => {
    b.classList.toggle("active", arr.includes(Number(b.dataset.value)));
    applyLevelToggleStyle(b);
  });
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

// 現在の実効テーマ("light" or "dark")を、手動設定→なければOS設定の順で判定する
function getEffectiveTheme() {
  const manual = document.documentElement.getAttribute("data-theme");
  if (manual === "light" || manual === "dark") return manual;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// ヘッダーのロゴ画像を現在のテーマに合わせて出し分ける
// (Light.svg=黒アイコン→ライト背景用 / Dark.svg=白アイコン→ダーク背景用)
function updateHeaderLogo() {
  const img = document.getElementById("header-logo-img");
  if (!img) return;
  img.src = getEffectiveTheme() === "dark" ? "assets/Y-pen_icon_Dark.svg" : "assets/Y-pen_icon_Light.svg";
}

function applyTheme(theme) {
  // theme: "light" | "dark" | "auto"
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  updateHeaderLogo();
}

function initTheme() {
  const saved = localStorage.getItem("ynoteq-theme") || "auto";
  applyTheme(saved);
  // "auto"設定時、OSのライト/ダーク切替にもロゴ表示を追従させる
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.getAttribute("data-theme")) updateHeaderLogo();
  });
}

// ライト/ダークを手動でトグルする(現在の見た目を見て反転させる)
function toggleTheme() {
  const current = getEffectiveTheme();
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

// アイコンの表示内容を組み立てて要素に反映する共通処理(仕様修正2026/09/12 No.2-1)。
// ・avatarNumberが4桁の数字の場合: 上段に番号、下段に表示文字(将来の団体管理用の通し番号+個人名)。
// ・それ以外: 表示文字(最大2文字・数字可)のみを1行で表示し、未設定ならユーザーネームの頭文字にフォールバックする。
// 表示文字は横書きのまま改行されないよう、呼び出し側のCSS(.avatar-twoline / white-space:nowrap)と対になっている。
function renderAvatarContent(el, { number, text, username } = {}) {
  const hasNumber = /^\d{4}$/.test(number || "");
  const line = text || (username && username[0] ? username[0].toUpperCase() : "?");
  if (hasNumber) {
    el.classList.add("avatar-twoline");
    el.innerHTML = `<span class="avatar-line">${escapeHtml(number)}</span><span class="avatar-line">${escapeHtml(line)}</span>`;
  } else {
    el.classList.remove("avatar-twoline");
    el.textContent = line;
  }
}
YNQ.renderAvatarContent = renderAvatarContent;

// ログイン中ユーザーの情報をヘッダーのアカウントアイコンに反映する
// 仕様修正2026/09/12 No.5: 表示文字はユーザーが指定した avatarText(最大2文字・数字可)を優先し、
// 未設定の場合のみユーザーネームの頭文字にフォールバックする。
async function loadAccountBadge(user) {
  const badge = document.getElementById("btn-account");
  let username = user.email ? user.email.split("@")[0] : "";
  let text = "", number = "";
  let color = AVATAR_COLORS[hashString(user.uid) % AVATAR_COLORS.length];

  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (doc.exists) {
      const data = doc.data();
      if (data.username) username = data.username;
      if (data.avatarColor) color = data.avatarColor;
      if (data.avatarText) text = data.avatarText.toUpperCase();
      if (data.avatarNumber) number = data.avatarNumber;
    }
  } catch (err) {
    console.error("[loadAccountBadge]", err);
  }

  renderAvatarContent(badge, { number, text, username });
  badge.style.background = color;
}
// アカウントタブでプロフィールを保存した直後、ヘッダーのアイコンにも即座に反映するための公開関数
YNQ.refreshAccountBadge = () => YNQ.currentUser && loadAccountBadge(YNQ.currentUser);

// タブ(tabs/*.html)を読み込んだ直後に呼び出す初期化関数の対応表。
// fetchしたHTML断片内の<script>はブラウザの仕様上自動実行されないため、
// 各タブのロジックは js/folders.js・js/wordlist.js 側で定義し、ここから呼び出す。
const TAB_INIT_HOOKS = {
  home: () => window.FoldersTab && window.FoldersTab.init(),
  wordlist: () => window.WordlistTab && window.WordlistTab.init(),
  test: () => window.TestTab && window.TestTab.init(),
  edit: () => window.EditTab && window.EditTab.init(),
  share: () => window.ShareTab && window.ShareTab.init(),
  account: () => window.AccountTab && window.AccountTab.init()
};

// タブの中身(tabs/*.html)を読み込んで #tab-content-area に差し込む(履歴には残さない実処理本体)。
// ※ file:// で直接開くとブラウザのセキュリティ制限でfetchが失敗するため、
//   必ずローカルサーバー(Live Server / firebase serve 等)を経由して開いてください。
async function renderTab(tabName) {
  const area = document.getElementById("tab-content-area");
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  // 「フォルダー」タブ以外の時だけ単語帳名エリアを表示する
  const titleEl = document.getElementById("header-booktitle");
  titleEl.hidden = (tabName === "home");
  if (tabName === "home") YNQ.currentBook = null; // フォルダータブに戻ったら単語帳の選択状態を解除

  // 仕様修正2026/09/12 #3: フォルダー一覧/単語帳一覧を見ている間はタブバー自体を非表示にし、
  // 単語帳を開いている(フォルダー以外のタブにいる)時だけタブの項目を表示する
  document.getElementById("tab-bar").hidden = (tabName === "home");

  try {
    const res = await fetch(`tabs/${tabName}.html`);
    if (!res.ok) throw new Error(`tabs/${tabName}.html が見つかりません`);
    area.innerHTML = await res.text();
    if (TAB_INIT_HOOKS[tabName]) TAB_INIT_HOOKS[tabName]();
  } catch (err) {
    console.error("[loadTab]", err);
    area.innerHTML = `<div class="placeholder-card"><i class="fa-solid fa-triangle-exclamation"></i><p>このタブは準備中です(Phase 2以降で実装予定)。</p></div>`;
  }
}

/* ----------------------------------------------------------
   7.5 画面内「戻る」ナビゲーション(仕様修正2026/09/12 #5)
   ブラウザの History API を使い、タブ/フォルダーの移動を1手ずつ記録する。
   ヘッダーの「←」ボタンは history.back() を呼ぶだけで、
   popstate イベント側で実際の画面復元を行う。
   ---------------------------------------------------------- */
let navHistoryStarted = false;

function currentNavState(tabName) {
  return {
    tab: tabName,
    folderId: YNQ.currentFolder ? YNQ.currentFolder.id : null,
    folderName: YNQ.currentFolder ? YNQ.currentFolder.name : null,
    folderColor: YNQ.currentFolder ? YNQ.currentFolder.color : null,
    bookId: YNQ.currentBook ? YNQ.currentBook.id : null,
    bookName: YNQ.currentBook ? YNQ.currentBook.name : null,
    bookColor: YNQ.currentBook ? YNQ.currentBook.color : null
  };
}

// 現在の状態を履歴に積む。ログイン直後の最初の1回だけ replaceState にして、
// アプリを開いた瞬間に「戻る」を押しても圏外に出てしまわないようにしている。
function pushNavState(tabName) {
  const state = currentNavState(tabName);
  if (!navHistoryStarted) {
    history.replaceState(state, "", "#" + tabName);
    navHistoryStarted = true;
  } else {
    history.pushState(state, "", "#" + tabName);
  }
}

// タブの中身を読み込んで表示し、履歴にも積む(アプリ内のタブ遷移は基本的にこちらを呼ぶ)
function loadTab(tabName) {
  pushNavState(tabName);
  return renderTab(tabName);
}
YNQ.loadTab = loadTab;
YNQ.pushNavState = pushNavState;

// ブラウザの「戻る/進む」操作(ヘッダーの←ボタンも history.back() 経由でここに来る)
window.addEventListener("popstate", (e) => {
  const state = e.state;
  if (!state) return; // アプリ読み込み前の状態などは無視
  YNQ.currentFolder = state.folderId ? { id: state.folderId, name: state.folderName, color: state.folderColor } : null;
  YNQ.currentBook = state.bookId ? { id: state.bookId, name: state.bookName, color: state.bookColor } : null;
  if (state.bookId) document.getElementById("header-booktitle").textContent = state.bookName;
  renderTab(state.tab);
});

// js/folders.js から呼ばれる: 単語帳を開いて単語一覧タブへ遷移する
function openWordbook(folder, book) {
  YNQ.currentFolder = folder;
  YNQ.currentBook = book;
  document.getElementById("header-booktitle").textContent = book.name;
  loadTab("wordlist");
}
YNQ.openWordbook = openWordbook;

function setupHeaderInteractions() {
  // ロゴクリックでホーム(フォルダー一覧のルート)へ。開いているフォルダーの選択状態もリセットする
  document.getElementById("btn-logo-home").addEventListener("click", () => {
    YNQ.currentFolder = null;
    loadTab("home");
  });

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
    loadTab("account");
  });
  document.getElementById("menu-bugreport").addEventListener("click", () => {
    closeAllPopovers();
    showToast("バグ報告機能は準備中です");
  });
  // 仕様追加2026/09/12 No.5: 「サポートする」メニュー項目(機能は後日追加予定)
  document.getElementById("menu-support").addEventListener("click", () => {
    closeAllPopovers();
    showToast("サポート機能は準備中です");
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

// 汎用の確認ダイアログ(削除/リセット/インストールなど様々な操作から呼び出す)。
// 仕様修正2026/09/12 No.3-4: OKボタンの文言が常に「削除する」固定だったため、
// 呼び出し側で操作に応じた文言(例: 「リセットする」「インストールする」)と危険度を指定できるようにする。
function confirmDialog(message, onConfirm, okLabel = "削除する", danger = true) {
  document.getElementById("confirm-message").textContent = message;
  openModal("modal-confirm");
  const okBtn = document.getElementById("btn-confirm-ok");
  const newOkBtn = okBtn.cloneNode(true); // 直前のリスナーを消すため差し替える
  okBtn.parentNode.replaceChild(newOkBtn, okBtn);
  newOkBtn.textContent = okLabel;
  newOkBtn.classList.toggle("btn-danger", danger);
  newOkBtn.classList.toggle("btn-primary", !danger);
  newOkBtn.addEventListener("click", () => { closeModal("modal-confirm"); onConfirm(); });
}


/* ----------------------------------------------------------
   7.6 ランク制度: ログインボーナス(仕様追加2026/09/12 No.4-D)
   ---------------------------------------------------------- */

// ピーク(最高到達)ランクを必要なら更新する共通処理(仕様R: ランク履歴表示用)。
// updateDataオブジェクトに直接 peakRank/peakRankAt を追記する(呼び出し側でset/updateする想定)。
function maybeUpdatePeakRank(updateData, peakRank, newRank) {
  const isSame = peakRank && peakRank.tier === newRank.tier && peakRank.division === newRank.division;
  if (!isSame && YNQ_RANK.isRankHigherOrEqual(newRank, peakRank)) {
    updateData.peakRank = { tier: newRank.tier, division: newRank.division };
    updateData.peakRankAt = firebase.firestore.FieldValue.serverTimestamp();
  }
}
YNQ.maybeUpdatePeakRank = maybeUpdatePeakRank;

// 仕様追加2026/09/12 No.5-7: ランクが上がった(推移した)場合に履歴へ記録する。
// 同じ期間内は複数件そのまま並び、期間が終了すると applySeasonalRankCheckIfNeeded 側で
// その期間内の最高ランクだけを残して他は削除される。
async function logRankPromotionIfNeeded(userRef, oldRank, newRank) {
  const oldIndex = (oldRank && oldRank.tier !== "Unranked") ? YNQ_RANK.findStepIndex(oldRank.tier, oldRank.division) : -1;
  const newIndex = YNQ_RANK.findStepIndex(newRank.tier, newRank.division);
  if (newIndex <= oldIndex) return; // 維持/降格の場合は記録しない
  try {
    await userRef.collection("rankHistory").add({
      rank: { tier: newRank.tier, division: newRank.division },
      achievedAt: firebase.firestore.FieldValue.serverTimestamp(),
      period: YNQ_RANK.seasonLabel(new Date())
    });
  } catch (err) {
    console.error("[logRankPromotionIfNeeded]", err);
  }
}
YNQ.logRankPromotionIfNeeded = logRankPromotionIfNeeded;

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// 仕様D: ログインすると1日1回、ライトランク帯10pt/高ランク帯5ptを付与する(0:00リセット)。
// ランクがまだ付いていない(Unranked)間は対象外(仕様A参照)。
async function applyDailyLoginBonusIfNeeded(user) {
  const userRef = db.collection("users").doc(user.uid);
  try {
    const doc = await userRef.get();
    if (!doc.exists) return;
    const data = doc.data();
    const rank = data.rank;
    if (!rank || rank.tier === "Unranked") return;

    const today = todayYmd();
    if (data.lastLoginBonusDate === today) return; // 本日分はすでに付与済み

    const bonus = YNQ_RANK.tierBand(rank.tier) === "light" ? 10 : 5; // 仕様D(ライト帯10pt/高ランク帯5pt)
    const newRank = YNQ_RANK.applyRankPointsDelta(rank, bonus);
    const updateData = { rank: newRank, lastLoginBonusDate: today };
    maybeUpdatePeakRank(updateData, data.peakRank, newRank);
    await userRef.set(updateData, { merge: true });
    await logRankPromotionIfNeeded(userRef, rank, newRank);
    // 仕様修正2026/09/12 No.5-9: ログインボーナスも「テスト実施記録・ポイント獲得記録」に残す
    await userRef.collection("testResults").add({
      type: "login",
      pointsEarned: bonus,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast(`ログインボーナス +${bonus}pt`);
  } catch (err) {
    console.error("[applyDailyLoginBonusIfNeeded]", err);
  }
}

/* ----------------------------------------------------------
   7.7 ランク制度: 期間の集約・奇数月末デモーション(仕様追加2026/09/12 No.4-Q,R / No.5-6,7)
   ※このアプリはサーバー側のスケジュール実行(cron等)を持たないため、あくまで
     「ユーザーがアプリを開いたタイミングで、前回チェック以降に期間の境界(奇数月末23:59)を
     またいでいないか」をその都度確認する形の簡易実装になっている。
   ---------------------------------------------------------- */
const SEASON_DEMOTION_TARGET_TIERS = ["Diamond", "Master", "Veritas"]; // 仕様Q

// 仕様R: 指定した期間(period)のrankHistoryのうち、最高ランクのものだけを残して他を削除する。
// (期間中は昇格のたびに複数件並ぶが、期間が終了したらその期間の最高到達ランク1件だけにする)
async function collapsePeriodHistory(userRef, period) {
  try {
    const snap = await userRef.collection("rankHistory").where("period", "==", period).get();
    if (snap.size <= 1) return; // 0件 or 1件なら集約不要
    let bestDoc = null, bestIndex = -1;
    snap.forEach(doc => {
      const r = doc.data().rank;
      const idx = r ? YNQ_RANK.findStepIndex(r.tier, r.division) : -1;
      if (idx > bestIndex) { bestIndex = idx; bestDoc = doc; }
    });
    const batch = db.batch();
    snap.forEach(doc => { if (!bestDoc || doc.id !== bestDoc.id) batch.delete(doc.ref); });
    await batch.commit();
  } catch (err) {
    console.error("[collapsePeriodHistory]", err);
  }
}

async function applySeasonalRankCheckIfNeeded(user) {
  const userRef = db.collection("users").doc(user.uid);
  try {
    const doc = await userRef.get();
    if (!doc.exists) return;
    const data = doc.data();
    const rank = data.rank;
    const now = new Date();
    const lastCheck = (data.lastSeasonCheckAt && data.lastSeasonCheckAt.toDate) ? data.lastSeasonCheckAt.toDate() : now;

    const boundaries = YNQ_RANK.listSeasonBoundariesCrossed(lastCheck, now);
    if (boundaries.length === 0) {
      await userRef.set({ lastSeasonCheckAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    // 仕様R: またいだ期間ごとに、その期間内の最高ランクだけを残して履歴を集約する(全ユーザー対象)
    for (const boundary of boundaries) {
      await collapsePeriodHistory(userRef, YNQ_RANK.seasonLabel(boundary));
    }

    // 仕様Q: Diamond/Master/Veritasのみ、対象タイミングを1回またぐごとにランクを2段階下げる
    let currentRank = rank;
    let demoted = false;
    if (rank) {
      for (let i = 0; i < boundaries.length; i++) {
        if (!SEASON_DEMOTION_TARGET_TIERS.includes(currentRank.tier)) break; // 降格して対象外になったら打ち切り
        currentRank = YNQ_RANK.demoteRankBySteps(currentRank, 2);
        demoted = true;
      }
    }

    const updateData = { lastSeasonCheckAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (demoted) updateData.rank = currentRank;
    await userRef.set(updateData, { merge: true });
    if (demoted) showToast(`定期デモーションにより ${YNQ_RANK.rankLabel(currentRank)} に降格しました`);
  } catch (err) {
    console.error("[applySeasonalRankCheckIfNeeded]", err);
  }
}


/* ----------------------------------------------------------
   8. 認証状態の監視(ログイン/ログアウトで画面を切り替える)
   ---------------------------------------------------------- */

auth.onAuthStateChanged((user) => {
  YNQ.currentUser = user;
  if (user) {
    document.getElementById("screen-login").hidden = true;
    document.getElementById("screen-register").hidden = true;
    document.getElementById("app-shell").hidden = false;
    loadAccountBadge(user);
    applyDailyLoginBonusIfNeeded(user); // 仕様D
    applySeasonalRankCheckIfNeeded(user); // 仕様Q
    loadTab("home"); // タブバー自体の表示/非表示は renderTab 側で制御する
  } else {
    document.getElementById("app-shell").hidden = true;
    document.getElementById("tab-bar").hidden = true;
    YNQ.currentFolder = null;
    YNQ.currentBook = null;
    navHistoryStarted = false; // 次回ログイン時にまた履歴の起点をやり直せるようにする
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
