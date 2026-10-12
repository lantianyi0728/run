/* ============================================================
   calc.js — 评估与计算算法
   包含：身体指标、代谢、心率区间、配速换算、成绩预测、综合状态评分
   ============================================================ */

var Calc = (function () {

  var STD_DIST = [
    { key: '3k', label: '3 公里', km: 3 },
    { key: '5k', label: '5 公里', km: 5 },
    { key: '10k', label: '10 公里', km: 10 },
    { key: 'half', label: '半程马拉松', km: 21.0975 },
    { key: 'full', label: '全程马拉松', km: 42.195 }
  ];

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function isNum(v) { return v !== null && v !== undefined && v !== '' && !isNaN(v); }
  function round(v, n) { var p = Math.pow(10, n || 0); return Math.round(v * p) / p; }

  /* ---------------- 格式 ---------------- */
  function fmtPace(secPerKm) {
    if (!isNum(secPerKm) || secPerKm <= 0) return '--';
    var s = Math.round(secPerKm);
    var m = Math.floor(s / 60), ss = s % 60;
    return m + "'" + (ss < 10 ? '0' + ss : ss) + '"';
  }
  function fmtPaceUnit(secPerKm) {
    return fmtPace(secPerKm) + '/km';
  }
  function fmtDur(sec) {
    if (!isNum(sec) || sec < 0) return '--';
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    if (h > 0) return h + ':' + p(m) + ':' + p(s);
    return m + ':' + p(s);
  }
  function fmtDurLong(sec) {
    if (!isNum(sec)) return '--';
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    return m + ' 分 ' + (sec % 60) + ' 秒';
  }
  function parsePace(str) {
    if (!str) return null;
    var m = String(str).trim().match(/^(\d{1,3})\s*[:'’\"]\s*(\d{1,2})?/);
    if (!m) return null;
    var mm = parseInt(m[1], 10), ss = m[2] ? parseInt(m[2], 10) : 0;
    if (isNaN(mm) || mm <= 0) return null;
    return mm * 60 + ss;
  }

  /* ---------------- 身体指标 ---------------- */
  function bmi(weightKg, heightCm) {
    if (!isNum(weightKg) || !isNum(heightCm) || heightCm <= 0) return null;
    var h = heightCm / 100;
    return round(weightKg / (h * h), 1);
  }

  // 中国成人 BMI 标准
  function bmiLevel(v) {
    if (!isNum(v)) return { text: '未知', key: 'grey' };
    if (v < 18.5) return { text: '偏瘦', key: 'blue' };
    if (v < 24) return { text: '正常', key: 'teal' };
    if (v < 28) return { text: '超重', key: 'amber' };
    return { text: '肥胖', key: 'danger' };
  }

  // Deurenberg 体脂估算公式
  function estimateBodyFat(gender, age, bmiVal) {
    if (!isNum(age) || !isNum(bmiVal)) return null;
    var sex = gender === 'female' ? 0 : 1;
    var bf = 1.20 * bmiVal + 0.23 * age - 10.8 * sex - 5.4;
    return round(clamp(bf, 3, 60), 1);
  }

  function bodyFatLevel(gender, age, bf) {
    if (!isNum(bf)) return { text: '未知', key: 'grey' };
    var a = isNum(age) ? age : 30;
    var male = gender !== 'female';
    if (male) {
      if (a < 40) {
        if (bf < 6) return { text: '偏低', key: 'blue' };
        if (bf < 14) return { text: '运动员', key: 'teal' };
        if (bf < 19) return { text: '健康', key: 'teal' };
        if (bf < 26) return { text: '偏高', key: 'amber' };
        return { text: '肥胖', key: 'danger' };
      }
      if (bf < 8) return { text: '偏低', key: 'blue' };
      if (bf < 16) return { text: '运动员', key: 'teal' };
      if (bf < 22) return { text: '健康', key: 'teal' };
      if (bf < 28) return { text: '偏高', key: 'amber' };
      return { text: '肥胖', key: 'danger' };
    }
    if (a < 40) {
      if (bf < 14) return { text: '偏低', key: 'blue' };
      if (bf < 21) return { text: '运动员', key: 'teal' };
      if (bf < 28) return { text: '健康', key: 'teal' };
      if (bf < 34) return { text: '偏高', key: 'amber' };
      return { text: '肥胖', key: 'danger' };
    }
    if (bf < 16) return { text: '偏低', key: 'blue' };
    if (bf < 24) return { text: '运动员', key: 'teal' };
    if (bf < 31) return { text: '健康', key: 'teal' };
    if (bf < 37) return { text: '偏高', key: 'amber' };
    return { text: '肥胖', key: 'danger' };
  }

  // Mifflin-St Jeor
  function bmr(p) {
    if (!isNum(p.weight) || !isNum(p.height) || !isNum(p.age)) return null;
    var base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
    return Math.round(p.gender === 'female' ? base - 161 : base + 5);
  }

  function tdee(p) {
    var b = bmr(p);
    if (!b) return null;
    var act = isNum(p.activity) ? Number(p.activity) : 1.375;
    // 运动额外消耗：按周跑量粗略折算
    return Math.round(b * act);
  }

  function maxHR(age) {
    if (!isNum(age)) return null;
    return Math.round(208 - 0.7 * age); // Tanaka 公式
  }

  function hrZones(max) {
    if (!isNum(max)) return [];
    var def = [
      { name: 'Z1 恢复区', lo: .50, hi: .60, color: '#8fb8ff', use: '热身 / 恢复跑，能轻松聊天' },
      { name: 'Z2 有氧区', lo: .60, hi: .70, color: '#4ede9d', use: '轻松跑主力区间，打基础最有效' },
      { name: 'Z3 节奏区', lo: .70, hi: .80, color: '#ffd166', use: '节奏跑 / 长距离后半程' },
      { name: 'Z4 阈値区', lo: .80, hi: .90, color: '#ff9f5c', use: '阈値跑，提升乳酸门槛' },
      { name: 'Z5 最大区', lo: .90, hi: 1.00, color: '#ff6a6a', use: '间歇 / 冲刺，量要少' }
    ];
    return def.map(function (z) {
      return {
        name: z.name, color: z.color, use: z.use,
        lo: Math.round(max * z.lo), hi: Math.round(max * z.hi),
        text: Math.round(max * z.lo) + ' - ' + Math.round(max * z.hi) + ' 次/分'
      };
    });
  }

  function idealWeightRange(heightCm) {
    if (!isNum(heightCm)) return null;
    var h = heightCm / 100;
    return { lo: round(18.5 * h * h, 1), hi: round(23.9 * h * h, 1) };
  }

  /* ---------------- 配速 / 成绩 ---------------- */
  function avgPaceOf(runs) {
    var sec = 0, km = 0;
    runs.forEach(function (r) { sec += r.seconds || 0; km += r.distance || 0; });
    if (km <= 0) return null;
    return sec / km;
  }
  function totalKm(runs) {
    return round(runs.reduce(function (s, r) { return s + (r.distance || 0); }, 0), 2);
  }

  // Riegel 公式：T2 = T1 * (D2/D1)^1.06
  function riegel(t1, d1, d2) {
    if (!isNum(t1) || !isNum(d1) || !isNum(d2) || d1 <= 0) return null;
    return t1 * Math.pow(d2 / d1, 1.06);
  }

  /**
   * 用历史记录预测各标准距离成绩
   * 规则：只用距离 ≥ 目标距离 25% 的记录，避免过度外推
   */
  function racePredict(runs) {
    var recent = runs.filter(function (r) {
      if (!r.distance || !r.seconds) return false;
      var days = Store.daysBetween(r.date, Store.today());
      return days <= 180;
    });
    var out = {};
    STD_DIST.forEach(function (s) {
      var best = null, src = null;
      recent.forEach(function (r) {
        if (r.distance < s.km * 0.25) return;
        var t = riegel(r.seconds, r.distance, s.km);
        if (t && (best === null || t < best)) { best = t; src = r; }
      });
      if (best) {
        out[s.key] = {
          km: s.km, label: s.label, seconds: best,
          pace: best / s.km, from: src
        };
      }
    });
    return out;
  }

  // 跑力指数（以 5K 等效成绩换算，100 分为准精英水平）
  function runningIndex(pred) {
    if (!pred || !pred['5k']) return null;
    var t = pred['5k'].seconds;
    return clamp(Math.round(100 - (t - 900) / 15), 15, 100);
  }

  /**
   * 训练配速区间
   * 锚点：优先用目标配速，否则用预测 10K 配速（近似阈値配速）
   */
  function trainingPaces(anchorPace) {
    if (!isNum(anchorPace) || anchorPace <= 0) return null;
    return [
      { key: 'E', name: '轻松跑 E', sec: anchorPace + 65, use: '占周跑量 70-80%，可以正常说话' },
      { key: 'M', name: '马拉松配速 M', sec: anchorPace + 22, use: '长距离课的后半段，练比赛节奏' },
      { key: 'T', name: '阈値跑 T', sec: anchorPace + 3, use: '20-40 分钟持续跑，接近"舒适的痛苦"' },
      { key: 'I', name: '间歇 I', sec: anchorPace - 14, use: '800-1600m 重复，组间慢跑恢复' },
      { key: 'R', name: '重复跑 R', sec: anchorPace - 28, use: '200-400m 短冲，提升速度与跑姿' }
    ];
  }

  /* ---------------- 综合身体状态评估 ---------------- */
  function scoreBand(v, lo, hi, tol) {
    if (!isNum(v)) return null;
    if (v >= lo && v <= hi) {
      // 落在理想区间内部：越靠近中点分数越高（100），贴边 93 分
      var mid = (lo + hi) / 2, half = (hi - lo) / 2;
      if (half <= 0) return 100;
      var k = Math.abs(v - mid) / half;
      return Math.round(100 - Math.min(1, k) * 7);
    }
    var d = v < lo ? lo - v : v - hi;
    return Math.round(clamp(93 - (d / tol) * 93, 0, 93));
  }

  function levelTargetKm(level) {
    if (level === 'beginner') return 12;
    if (level === 'advanced') return 45;
    return 26;
  }

  /**
   * 综合评估
   * @returns {score, level, levelKey, items[], advice[], metrics{}}
   */
  function evaluateBody(p, runs, checkins) {
    var items = [];
    var metrics = {};

    /* 1. BMI */
    var bmiVal = bmi(p.weight, p.height);
    metrics.bmi = bmiVal;
    var bmiS = scoreBand(bmiVal, 18.5, 23.9, 9);
    items.push({
      name: '体重指数',
      value: isNum(bmiVal) ? bmiVal + ' ' + bmiLevel(bmiVal).text : '未填写',
      score: bmiS,
      tag: bmiS === null ? null : bmiS >= 88 ? '优秀' : bmiS >= 70 ? '良好' : bmiS >= 50 ? '一般' : '待改善',
      note: isNum(bmiVal)
        ? (bmiVal < 18.5 ? '体重偏轻，注意营养与力量训练，避免过度消耗。'
          : bmiVal < 24 ? '体重处于健康区间，非常利于跑步表现与关节保护。'
            : '体重偏高会给膝踝带来额外冲击，建议配合有氧 + 饮食控制逐步下降。')
        : '尚未填写身高体重，无法评估。'
    });

    /* 2. 体脂率 */
    var bf = isNum(p.bodyFat) ? Number(p.bodyFat) : estimateBodyFat(p.gender, p.age, bmiVal);
    metrics.bodyFat = bf;
    metrics.bodyFatEstimated = !isNum(p.bodyFat) && isNum(bf);
    var bfIdeal = p.gender === 'female'
      ? { lo: isNum(p.age) && p.age >= 40 ? 17 : 16, hi: isNum(p.age) && p.age >= 40 ? 31 : 28 }
      : { lo: isNum(p.age) && p.age >= 40 ? 9 : 8, hi: isNum(p.age) && p.age >= 40 ? 22 : 19 };
    var bfS = scoreBand(bf, bfIdeal.lo, bfIdeal.hi, 12);
    items.push({
      name: '体脂率',
      value: isNum(bf) ? bf + '% ' + bodyFatLevel(p.gender, p.age, bf).text + (metrics.bodyFatEstimated ? '（估算）' : '') : '未填写',
      score: bfS,
      tag: bfS === null ? null : bfS >= 88 ? '优秀' : bfS >= 70 ? '良好' : bfS >= 50 ? '一般' : '待改善',
      note: isNum(bf)
        ? (bf > bfIdeal.hi ? '体脂偏高，跑步是最经济的降脂方式，坚持 Z2 有氧效果最好。'
          : bf < bfIdeal.lo ? '体脂偏低，注意补充优质脂肪与蛋白质，避免免疫力下降。'
            : '体脂处于跑者的理想区间，跑步经济性好。')
        : '未填写体脂率，可按公式估算或体测后补填。'
    });

    /* 3. 静息心率 */
    var rhr = isNum(p.restHR) ? Number(p.restHR) : null;
    metrics.restHR = rhr;
    var rhrS = rhr === null ? null : scoreBand(rhr, 42, 62, 32);
    items.push({
      name: '静息心率',
      value: rhr === null ? '未填写' : rhr + ' 次/分',
      score: rhrS,
      tag: rhrS === null ? null : rhrS >= 88 ? '优秀' : rhrS >= 70 ? '良好' : rhrS >= 50 ? '一般' : '待改善',
      note: rhr === null ? '未填写静息心率。晨起清醒未下床时测 1 分钟最准。'
        : rhr <= 55 ? '静息心率很低，说明有氧基础扎实，心脏工作效率高。'
          : rhr <= 65 ? '静息心率在健康跑步者水平。'
            : rhr <= 75 ? '略偏高，多与训练量不足、睡眠不足或压力有关。'
              : '偏高，建议保证睡眠、减少熬夜，并逐步增加有氧跑量。'
    });

    /* 4. 训练量（近 4 周周均跑量） */
    var since28 = runs.filter(function (r) { return Store.daysBetween(r.date, Store.today()) <= 27; });
    var km28 = totalKm(since28);
    var weeklyAvg = round(km28 / 4, 1);
    metrics.weeklyAvgKm = weeklyAvg;
    var target = levelTargetKm(p.level);
    var ratio = weeklyAvg / target;
    var volS = Math.round(clamp(ratio * 100, 0, 100));
    if (ratio > 1.7) volS = 82; // 过量训练轻度扣分
    items.push({
      name: '训练跑量',
      value: weeklyAvg + ' km/周',
      score: volS,
      tag: volS >= 88 ? '优秀' : volS >= 70 ? '良好' : volS >= 50 ? '一般' : '待改善',
      note: '按你的水平，建议周跑量在 ' + Math.round(target * 0.8) + '-' + Math.round(target * 1.3) + ' km。'
        + (ratio < 0.6 ? ' 目前偏少，先以"每周增加不超过 10%"的节奏慢慢加。'
          : ratio > 1.7 ? ' 目前偏多，注意恢复，避免过度训练。'
            : ' 目前跑量合适，继续保持。')
    });

    /* 5. 运动规律性 */
    var activeDays = {};
    runs.forEach(function (r) { activeDays[r.date] = 1; });
    Object.keys(checkins || {}).forEach(function (d) { activeDays[d] = 1; });
    var active28 = Object.keys(activeDays).filter(function (d) {
      return Store.daysBetween(d, Store.today()) <= 27 && Store.daysBetween(d, Store.today()) >= 0;
    }).length;
    metrics.activeDays28 = active28;
    var regS = Math.round(clamp(active28 / 16 * 100, 0, 100)); // 目标：28 天约 16 天活动
    items.push({
      name: '规律性',
      value: active28 + ' 天 / 28 天',
      score: regS,
      tag: regS >= 88 ? '优秀' : regS >= 70 ? '良好' : regS >= 50 ? '一般' : '待改善',
      note: active28 >= 16 ? '运动频率很稳定，这是进步最重要的一件事。'
        : active28 >= 9 ? '频率还可以，若能稳定到每周 4 次效果会明显更好。'
          : '活动天数偏少，先把"每周固定 3 次"变成习惯，比一次跑很久更有用。'
    });

    /* 汇总 */
    var weights = { '体重指数': .18, '体脂率': .18, '静息心率': .18, '训练跑量': .26, '规律性': .20 };
    var sum = 0, wsum = 0;
    items.forEach(function (it) {
      if (it.score === null) return;
      var w = weights[it.name] || .1;
      sum += it.score * w; wsum += w;
    });
    var score = wsum > 0 ? Math.round(sum / wsum) : 0;

    var level, levelKey, desc;
    var pending = (bmiS === null && bfS === null && rhrS === null && runs.length === 0);
    if (pending) {
      level = '待完善'; levelKey = 'grey';
      desc = '还没有任何数据。填写身高、体重、年龄，再记录一次跑步，我就能给出评估、跑量建议和饮食方案。';
    } else if (wsum === 0) {
      level = '待完善'; levelKey = 'grey';
      desc = '还没有足够的数据。先填写身高体重等基础信息，并记录 1-2 次跑步，我就能给出评估。';
    } else if (score >= 85) {
      level = '优秀'; levelKey = 'teal';
      desc = '身体状态非常好，有氧基础扎实。可以开始加入质量课（阈値 / 间歇）冲击成绩目标。';
    } else if (score >= 70) {
      level = '良好'; levelKey = 'blue';
      desc = '身体状态良好，跑步习惯已经建立。保持轻松跑为主，每周加入 1 次质量课就会稳步提升。';
    } else if (score >= 55) {
      level = '一般'; levelKey = 'amber';
      desc = '有一定基础但还有提升空间。建议先规律起来，把轻松跑跑扎实，别急着追配速。';
    } else {
      level = '待改善'; levelKey = 'danger';
      desc = '目前数据偏弱。别灰心——从每周 3 次、每次 20-30 分钟快走 / 慢跑开始，一个月就会看到变化。';
    }

    var advice = [];
    if (pending) {
      advice.push('先去「身体档案」填写身高、体重、年龄——这是所有评估和推荐的基础。');
      advice.push('记录你的第一次跑步，哪怕只有 2 公里、20 分钟，我就能算出配速和跑力水平。');
      advice.push('目标可以先不设，等积累几次记录后，我们再一起定一个合适的目标。');
    }
    if (bmiS !== null && bmiS < 70) advice.push('体重管理优先：有氧 + 饮食双管齐下，每周 0.3-0.5 kg 是安全速度。');
    if (rhr !== null && rhr > 72) advice.push('静息心率偏高：保证 7 小时以上睡眠，训练以低强度为主，别硬顶。');
    if (!pending && ratio < 0.6) advice.push('跑量从低处起：每周总跑量增幅控制在 10% 以内，避免受伤。');
    if (!pending && regS < 70) advice.push('提高频率比提高强度更重要：固定每周 3-4 天的跑步时间。');
    if (isNum(p.sleep) && p.sleep < 6.5) advice.push('睡眠不足会直接拖慢恢复，尽量保证 7 小时以上。');
    if (p.injury && p.injury !== '无' && p.injury.indexOf('无') !== 0) advice.push('有伤病史：跑前充分热身 8-10 分钟，跑后拉伸，出现疼痛立即停跑。');
    if (!advice.length) advice.push('状态不错，继续保持规律训练，注意跑量渐进与充分恢复。');

    return { score: score, level: level, levelKey: levelKey, desc: desc, items: items, advice: advice, metrics: metrics };
  }

  /* ---------------- 序列统计（图表用） ---------------- */
  // 近 n 周周跑量（含本周）
  function weeklySeries(runs, n) {
    n = n || 8;
    var out = [];
    var t = new Date();
    var dow = (t.getDay() + 6) % 7; // 周一为一周起点
    var startOfWeek = Store.addDays(Store.today(), -dow);
    for (var i = n - 1; i >= 0; i--) {
      var from = Store.addDays(startOfWeek, -7 * i);
      var to = Store.addDays(from, 6);
      var km = totalKm(runs.filter(function (r) { return r.date >= from && r.date <= to; }));
      out.push({ label: (i === 0 ? '本周' : (-i) + '周前'), from: from, km: km });
    }
    return out;
  }

  // 近 n 天配速走势（只有跑步的日子有点）
  function paceSeries(runs, n) {
    n = n || 30;
    var from = Store.addDays(Store.today(), -(n - 1));
    return runs.filter(function (r) { return r.date >= from; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .map(function (r) {
        return { date: r.date, pace: r.seconds / r.distance, km: r.distance };
      });
  }

  // 配速趋势（线性回归斜率，秒/km/次）
  function paceTrend(series) {
    if (series.length < 2) return 0;
    var n = series.length, sx = 0, sy = 0, sxy = 0, sxx = 0;
    series.forEach(function (p, i) {
      sx += i; sy += p.pace; sxy += i * p.pace; sxx += i * i;
    });
    var den = n * sxx - sx * sx;
    if (den === 0) return 0;
    return (n * sxy - sx * sy) / den; // 负值 = 越来越快
  }

  return {
    STD_DIST: STD_DIST,
    clamp: clamp, isNum: isNum, round: round,
    fmtPace: fmtPace, fmtPaceUnit: fmtPaceUnit, fmtDur: fmtDur, fmtDurLong: fmtDurLong,
    parsePace: parsePace,
    bmi: bmi, bmiLevel: bmiLevel,
    estimateBodyFat: estimateBodyFat, bodyFatLevel: bodyFatLevel,
    bmr: bmr, tdee: tdee, maxHR: maxHR, hrZones: hrZones,
    idealWeightRange: idealWeightRange,
    avgPaceOf: avgPaceOf, totalKm: totalKm,
    riegel: riegel, racePredict: racePredict, runningIndex: runningIndex,
    trainingPaces: trainingPaces,
    evaluateBody: evaluateBody,
    weeklySeries: weeklySeries, paceSeries: paceSeries, paceTrend: paceTrend
  };
})();
