/* ============================================================
   Y-NoteQ rank.js
   個人Levelの「ランク制度」(仕様追加2026/09/12 No.4)
   ・ランク階層/段階の定義、バンド判定、ポイント上限
   ・テストで獲得するポイントの計算(各ルールごとに定数化してあるので、
     後で数値を手動調整したい場合はこのファイルの POINTS_* / ACCURACY_BONUS_TABLE
     あたりを書き換えるだけでよい)
   ・ランクの昇格/降格(0pt割れの1回だけの猶予、降格時の開始pt)
   ・奇数月末デモーション用の判定ロジック
   ・バッジ画像パスの解決
   このファイルはFirestoreへのアクセスを行わない「純粋な計算ロジック」のみを持つ。
   実際にFirestoreへ読み書きするのは js/app.js(ログインボーナス・季節デモーション)と
   js/test.js(テスト結果のポイント加算)側の役割。
   ============================================================ */
window.YNQ_RANK = (function () {

  /* ----------------------------------------------------------
     1. ランク階層の定義
     ---------------------------------------------------------- */
  // 下から上への順番(Veritasのみ段階(division)を持たない特別枠)
  const TIER_ORDER = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Veritas"];
  const LIGHT_BAND_TIERS = ["Iron", "Bronze", "Silver", "Gold"];       // 仕様B: ライトランク帯
  const HIGH_BAND_TIERS = ["Platinum", "Diamond", "Master", "Veritas"]; // 仕様B: 高ランク帯

  // ランクptは常に小数第1位までの表記にする(仕様修正2026/09/12 No.5-5)。浮動小数点演算の
  // 誤差(0.1+0.2=0.30000000000000004 のような)を防ぐため、状態を書き換えるたびに丸める。
  function roundPt(n) { return Math.round((n || 0) * 10) / 10; }

  function tierHasDivisions(tier) { return tier !== "Veritas"; }
  function tierBand(tier) { return LIGHT_BAND_TIERS.includes(tier) ? "light" : "high"; }

  // 仕様: Gold以下は100ptがMax、Platinum以上は200ptがMax。Veritasだけは上限なし。
  function tierMaxPoints(tier) {
    if (tier === "Veritas") return null; // 上限なし
    return tierBand(tier) === "light" ? 100 : 200;
  }

  // ランクが下がった時の開始pt(仕様O): ライト帯80pt / 高ランク帯180pt
  function demotionStartPoints(tier) {
    return tierBand(tier) === "light" ? 80 : 180;
  }

  // 全ランクを「1段階ずつ」並べたフラットな配列を作る(Iron I が先頭、Veritas が末尾)。
  // 昇格/降格はこの配列のindexを1つ進める/戻すだけで扱える。
  const RANK_STEPS = (function buildSteps() {
    const steps = [];
    TIER_ORDER.forEach(tier => {
      if (tierHasDivisions(tier)) {
        for (let d = 1; d <= 3; d++) steps.push({ tier, division: d });
      } else {
        steps.push({ tier, division: null });
      }
    });
    return steps;
  })();

  function findStepIndex(tier, division) {
    return RANK_STEPS.findIndex(s => s.tier === tier && s.division === (division || null));
  }
  function stepAt(index) {
    const i = Math.max(0, Math.min(RANK_STEPS.length - 1, index));
    return RANK_STEPS[i];
  }

  // 表示用ラベル("Iron I" のようなローマ数字表記。Veritasは段階なし)
  const ROMAN = { 1: "Ⅰ", 2: "Ⅱ", 3: "Ⅲ" };
  function rankLabel(rank) {
    if (!rank || rank.tier === "Unranked") return "ランクなし(Unranked)";
    if (!tierHasDivisions(rank.tier)) return rank.tier;
    return `${rank.tier} ${ROMAN[rank.division] || rank.division}`;
  }

  // バッジ画像のファイルパス(仕様: Batch_Iron_1.svg のような命名。画像自体は準備中のため
  // assets/ranks/ にプレースホルダーを用意してある。届いたら同名で差し替えるだけでよい)
  function rankBadgeImagePath(rank) {
    if (!rank || rank.tier === "Unranked") return "assets/ranks/Batch_Unranked.svg";
    if (!tierHasDivisions(rank.tier)) return `assets/ranks/Batch_${rank.tier}.svg`;
    return `assets/ranks/Batch_${rank.tier}_${rank.division}.svg`;
  }

  /* ----------------------------------------------------------
     2. ランクの昇格/降格(仕様O: 0pt割れの1回だけの猶予・降格時の開始pt)
     ---------------------------------------------------------- */
  // rankState: { tier, division, points, graceUsed }
  //   tier: "Unranked" | TIER_ORDER のいずれか
  //   division: 1〜3 または Veritas/Unrankedはnull
  //   points: 現在の段階での保持pt
  //   graceUsed: 0pt割れの「1回だけとどまる」猶予をすでに使ったか
  function applyRankPointsDelta(rankState, delta) {
    if (!rankState || rankState.tier === "Unranked" || !delta) {
      return rankState; // Unrankedの間はポイント制度の対象外(仕様A参照)
    }
    const state = { tier: rankState.tier, division: rankState.division, points: rankState.points || 0, graceUsed: !!rankState.graceUsed };
    state.points = roundPt(state.points + delta);

    if (state.points < 0) {
      if (!state.graceUsed) {
        // 仕様O: 0ptになった場合は1回だけとどまれる(マイナス分は帳消しにして0ptで踏みとどまる)
        state.points = 0;
        state.graceUsed = true;
      } else {
        // 仕様O: 猶予を使った後に再度マイナスが発生したら1ランク下げる
        const curIndex = findStepIndex(state.tier, state.division);
        const prevStep = stepAt(curIndex - 1); // 先頭(Iron I)より下にはならない
        state.tier = prevStep.tier;
        state.division = prevStep.division;
        state.points = demotionStartPoints(prevStep.tier);
        state.graceUsed = false; // 降格したので猶予は新しい段階でリセット
      }
      return state;
    }

    // 昇格判定(上限を超えたら次の段階へ。超過分は繰り越す)
    let max = tierMaxPoints(state.tier);
    while (max !== null && state.points >= max) {
      const curIndex = findStepIndex(state.tier, state.division);
      if (curIndex >= RANK_STEPS.length - 1) {
        // すでにVeritas(上限なし)まで来ている場合はそれ以上昇格しない
        break;
      }
      const nextStep = stepAt(curIndex + 1);
      state.points = roundPt(state.points - max);
      state.tier = nextStep.tier;
      state.division = nextStep.division;
      state.graceUsed = false; // 昇格したので猶予はリセット
      max = tierMaxPoints(state.tier);
    }
    return state;
  }

  // 仕様Q用: ランクをステップ数だけ下げる(降格時の開始ptを付与)。Iron Iより下にはならない。
  function demoteRankBySteps(rankState, steps) {
    if (!rankState || rankState.tier === "Unranked") return rankState;
    const curIndex = findStepIndex(rankState.tier, rankState.division);
    const newStep = stepAt(curIndex - steps);
    return { tier: newStep.tier, division: newStep.division, points: demotionStartPoints(newStep.tier), graceUsed: false };
  }

  // ランクA(現在)がランクB(過去のpeak等)より高いかどうか(Unrankedが最下位)
  function isRankHigherOrEqual(rankA, rankB) {
    if (!rankA || rankA.tier === "Unranked") return false;
    if (!rankB || rankB.tier === "Unranked") return true;
    return findStepIndex(rankA.tier, rankA.division) >= findStepIndex(rankB.tier, rankB.division);
  }

  /* ----------------------------------------------------------
     3. テストのポイント計算
     各ルールの数値はここにまとめてあるので、後で調整したい場合はこの節だけ見ればよい。
     ---------------------------------------------------------- */
  const POINTS_TOUCH_LEVEL0_WORD = 0.1;      // 仕様E: Level0の単語に触れた(テスト方式問わず・正誤問わず)
  const POINTS_MAINTAIN_LEVEL1 = 1.5;        // 仕様H: Level1を維持(1→1)
  const POINTS_MAINTAIN_LEVEL_2TO5 = 0.5;    // 仕様I: Level2〜5を維持(X→X)
  const POINTS_LEVEL_UP_1 = -1.5;            // 仕様J: Levelが1上がった
  const POINTS_LEVEL_DOWN_FROM_2OR3 = 1.0;   // 仕様K: Level2or3から1下がった
  const POINTS_LEVEL_DOWN_FROM_4OR5 = 2.0;   // 仕様L: Level4or5から1下がった
  const POINTS_PER_10_QUESTIONS = 2.0;       // 仕様M: 10問ごとのボーナス(正答率無関係)
  const POINTS_RECENT_TOUCH_BONUS = 0.2;     // 仕様P: 直近5日以内に触れていた単語(正誤問わず)
  const RECENT_TOUCH_DAYS = 5;               // 仕様P

  // 仕様N: 正答率に応じたボーナス/ペナルティ(境界値は「以上未満」で判定)
  function accuracyBonusPoints(accPct) {
    if (accPct >= 100) return 3.0;
    if (accPct >= 90) return 2.0;
    if (accPct >= 80) return 1.5;
    if (accPct >= 70) return 1.0;
    if (accPct >= 50) return 0.5;
    if (accPct < 30) return -1.0;
    return 0; // 30%以上50%未満はそれ以外(0pt)
  }

  // Level遷移1件分のポイント(仕様H〜L)。0スタート(未実施→初回)の単語は仕様Eのみが適用され、
  // ここでは対象外として扱う(0pt)。
  function pointsForLevelTransition(levelBefore, levelAfter) {
    if (!levelBefore || levelBefore === 0) return 0; // 仕様Eで別途加算するためここでは0
    if (levelAfter === levelBefore) {
      return levelBefore === 1 ? POINTS_MAINTAIN_LEVEL1 : POINTS_MAINTAIN_LEVEL_2TO5;
    }
    if (levelAfter === levelBefore + 1) return POINTS_LEVEL_UP_1;
    if (levelAfter === levelBefore - 1) {
      if (levelBefore === 2 || levelBefore === 3) return POINTS_LEVEL_DOWN_FROM_2OR3;
      if (levelBefore === 4 || levelBefore === 5) return POINTS_LEVEL_DOWN_FROM_4OR5;
    }
    return 0; // 想定外の遷移
  }

  // "YYYY/MM/DD" 形式の文字列同士の日数差を計算する(仕様P用)
  function parseYmd(str) {
    const m = typeof str === "string" && str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function daysBetweenYmd(fromStr, toStr) {
    const a = parseYmd(fromStr), b = parseYmd(toStr);
    if (!a || !b) return Infinity;
    return Math.round((b - a) / (24 * 60 * 60 * 1000));
  }

  // テスト1回分の獲得ポイントを計算する。
  // answers: [{ levelBefore, levelAfter, isCorrect, prevLastTestDate }]
  //   prevLastTestDate: そのテストで更新される「前」の lastTestDate(仕様P判定用。test.js側で
  //   Firestoreを更新する前の値をここに積んでおいてもらう必要がある)
  // format: "flashcard" | "choice4" | "typed"
  // levelScoring: 設定画面の「Level採点」がONかどうか(OFFならLevelは変動しないため仕様H〜Lは0扱い)
  // today: "YYYY/MM/DD" 形式の今日の日付
  function computeTestPoints({ answers, format, levelScoring, today }) {
    const breakdown = { level0Touch: 0, levelTransition: 0, tenQuestionBonus: 0, accuracyBonus: 0, recentTouchBonus: 0 };

    // 仕様E: Level0の単語に触れた場合は、テスト方式・正誤を問わず常に加算
    (answers || []).forEach(a => {
      if ((a.levelBefore || 0) === 0) breakdown.level0Touch += POINTS_TOUCH_LEVEL0_WORD;
    });

    // 仕様G: ここから先は「単語カード」形式では加算しない
    if (format !== "flashcard") {
      // 仕様H〜L: LevelScoringがONの時だけ、Levelの維持/変動に応じて加算
      if (levelScoring) {
        (answers || []).forEach(a => {
          breakdown.levelTransition += pointsForLevelTransition(a.levelBefore, a.levelAfter);
        });
      }

      // 仕様M: 出題数10問ごとに+2pt(正答率は無関係)
      const totalQ = (answers || []).length;
      breakdown.tenQuestionBonus = Math.floor(totalQ / 10) * POINTS_PER_10_QUESTIONS;

      // 仕様N: 正答率に応じたボーナス/ペナルティ
      const correct = (answers || []).filter(a => a.isCorrect).length;
      const accPct = totalQ > 0 ? (correct / totalQ) * 100 : 0;
      breakdown.accuracyBonus = accuracyBonusPoints(accPct);

      // 仕様P: 直近5日以内に触れていた単語は1語につき+0.2pt(正誤問わず)
      (answers || []).forEach(a => {
        if (a.prevLastTestDate && today && daysBetweenYmd(a.prevLastTestDate, today) <= RECENT_TOUCH_DAYS) {
          breakdown.recentTouchBonus += POINTS_RECENT_TOUCH_BONUS;
        }
      });
    }

    const rawTotal = breakdown.level0Touch + breakdown.levelTransition + breakdown.tenQuestionBonus + breakdown.accuracyBonus + breakdown.recentTouchBonus;
    const total = Math.round(rawTotal * 10) / 10; // 小数第1位までに丸める
    return { total, breakdown };
  }

  /* ----------------------------------------------------------
     4. 季節期間(仕様追加2026/09/12 No.5-6)・奇数月末デモーション(仕様Q)の判定
     季節は2か月ごとの6区分で、奇数月末日23:59がちょうどその期間の境界と一致する
     (12-1月:Win, 2-3月:ESp, 4-5月:Spr, 6-7月:ESu, 8-9月:Sum, 10-11月:Aut)。
     ---------------------------------------------------------- */
  const SEASON_CODE_BY_START_MONTH = { 12: "Win", 2: "ESp", 4: "Spr", 6: "ESu", 8: "Sum", 10: "Aut" };

  // 表示用の期間ラベル(例: 2026年8月なら "26-Sum")。12-1月の期間は開始年(12月側)を採用する。
  function seasonLabel(date) {
    const m = date.getMonth() + 1; // 1〜12
    let startMonth = m % 2 === 0 ? m : m - 1; // 各期間の開始月(偶数月)に丸める
    let year = date.getFullYear();
    if (startMonth === 0) { startMonth = 12; year -= 1; } // 1月は前年12月始まりのWin期間
    const code = SEASON_CODE_BY_START_MONTH[startMonth];
    const yy = String(((year % 100) + 100) % 100).padStart(2, "0");
    return `${yy}-${code}`;
  }

  // fromDate(前回チェック時刻)〜toDate(今)の間にまたいだ「期間の境界(奇数月末日23:59)」を
  // 古い順に全て返す。長期間ログインしていなかった場合は複数個まとめて返る。
  function listSeasonBoundariesCrossed(fromDate, toDate) {
    if (!(fromDate instanceof Date) || !(toDate instanceof Date) || fromDate >= toDate) return [];
    const boundaries = [];
    let cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    while (cursor <= toDate) {
      const monthNumber = cursor.getMonth() + 1; // 1〜12
      if (monthNumber % 2 === 1) { // 奇数月(1,3,5,7,9,11)の末日が期間の境界
        const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 0, 0);
        if (lastDay > fromDate && lastDay <= toDate) boundaries.push(lastDay);
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return boundaries;
  }

  return {
    TIER_ORDER, LIGHT_BAND_TIERS, HIGH_BAND_TIERS, RANK_STEPS,
    tierHasDivisions, tierBand, tierMaxPoints, demotionStartPoints,
    findStepIndex, stepAt, rankLabel, rankBadgeImagePath,
    applyRankPointsDelta, demoteRankBySteps, isRankHigherOrEqual,
    computeTestPoints, accuracyBonusPoints, pointsForLevelTransition,
    listSeasonBoundariesCrossed, seasonLabel, daysBetweenYmd, roundPt
  };
})();
