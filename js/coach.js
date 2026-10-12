/* ============================================================
   coach.js — 训练与饮食推荐引擎
   依据：身体数据（身高/体重/体脂/静息心率/睡眠/水平）
         跑步记录（周跑量、配速、频率）
         用户目标（成绩 / 配速 / 日期，可缺省）
   ============================================================ */

var Coach = (function () {

  var HOME = '\u0000'; // 占位，避免误用

  /* ---------------- 通用 ---------------- */
  function r05(v) { return Math.round(v * 2) / 2; }   // 取到 0.5
  function round(v, n) { var p = Math.pow(10, n || 0); return Math.round(v * p) / p; }

  /* ---------------- 1. 周跑量推荐 ---------------- */
  function recommendVolume(profile, runs, goals) {
    var since28 = runs.filter(function (r) { return Store.daysBetween(r.date, Store.today()) <= 27; });
    var current = round(Calc.totalKm(since28) / 4, 1);
    var level = profile.level || 'intermediate';

    var ceilings = { beginner: 32, intermediate: 68, advanced: 120 };
    var starts = { beginner: 8, intermediate: 18, advanced: 32 };
    var ceiling = ceilings[level] || 60;

    var reasons = [];
    var started = false;

    var base = current;
    if (base <= 0.5) {
      base = starts[level] || 15;
      started = true;
      reasons.push('还没有稳定的跑量记录，按你的水平从 ' + base + ' km/周 起步（约每周 3 次）。');
    } else {
      reasons.push('近 4 周你平均每周跑 ' + current + ' km，以此为基准。');
    }

    // 目标推演：若有目标日期与目标成绩，计算所需进步幅度
    var goalNote = null;
    if (goals && goals.length) {
      var g = goals[0];
      var pred = Calc.racePredict(runs);
      var cur = pred[g.type] || (pred['10k'] ? { seconds: Calc.riegel(pred['10k'].seconds, 10, g.distanceKm) } : null);
      if (cur && g.targetSeconds) {
        var gain = 1 - (g.targetSeconds / cur.seconds); // 需要提升的比例
        if (gain > 0.18) {
          goalNote = '目标成绩相比当前水平需要提升约 ' + Math.round(gain * 100) + '%，属于较大跨度，建议把周期拉长到 12 周以上，跑量按每周 5-8% 递增。';
        } else if (gain > 0.06) {
          goalNote = '目标成绩需要提升约 ' + Math.round(gain * 100) + '%，是很合理的目标，6-10 周系统训练就有希望达成。';
        } else if (gain > -0.02) {
          goalNote = '目标与当前水平接近，重点是把配速跑稳、把状态在比赛日调到最好。';
        } else {
          goalNote = '目标成绩已经低于（快于）你当前的预测水平，说明目标偏保守，可以适当上调挑战一下。';
        }
      }
    } else {
      goalNote = '你还没有设定目标。可以先只设一个（例如 5 公里想跑进多少分钟），我会据此细化课表。';
    }

    // 递增 8%，上限保护
    var recommend = started ? base : base * 1.08;
    if (profile.injury && profile.injury !== '无' && profile.injury.indexOf('无') < 0) {
      recommend = Math.min(recommend, base * 1.03);
      reasons.push('你有伤病史，跑量递增放慢到 3%，安全第一。');
    }
    if (recommend > ceiling) {
      recommend = ceiling;
      reasons.push('已触及该水平的安全跑量上限 ' + ceiling + ' km/周，想再往上需要更系统化的周期训练。');
    }
    recommend = r05(recommend);
    if (!started && recommend - current < 0.5) recommend = current + 0.5;

    var nextWeek = r05(Math.min(recommend * 1.08, ceiling));

    return {
      current: current, recommend: recommend, nextWeek: nextWeek,
      ceiling: ceiling, started: started,
      range: [r05(recommend * 0.85), r05(recommend * 1.15)],
      reasons: reasons, goalNote: goalNote
    };
  }

  /* ---------------- 2. 配速锚点 ---------------- */
  function anchorPace(profile, runs, goals) {
    var pred = Calc.racePredict(runs);
    if (pred['10k']) return { pace: pred['10k'].pace, from: '根据你最近的跑步记录预测的 10 公里配速' };
    if (goals && goals.length) {
      var g = goals[0];
      if (g.targetSeconds && g.distanceKm) {
        var p = g.targetSeconds / g.distanceKm;
        // 目标距离越短，阈値配速略快；用 Riegel 归一到 10K
        var p10 = p * Math.pow(10 / g.distanceKm, 0.06);
        return { pace: p10, from: '根据你设定的目标成绩换算' };
      }
      if (g.targetPaceSec) return { pace: g.targetPaceSec, from: '根据你设定的目标配速' };
    }
    if (runs.length) {
      var recent = runs.filter(function (r) { return Store.daysBetween(r.date, Store.today()) <= 60; });
      var src = recent.length ? recent : runs;
      var fastest = src.slice().sort(function (a, b) { return (a.seconds / a.distance) - (b.seconds / b.distance); })[0];
      if (fastest) return { pace: fastest.seconds / fastest.distance + 15, from: '根据你最快一次跑步的配速粗略估算' };
    }
    return null;
  }

  /* ---------------- 3. 每周课表 ---------------- */
  var TEMPLATES = {
    beginner: [
      { day: '周一', rest: true, desc: '完全休息，或 20 分钟快走 / 拉伸' },
      { day: '周二', type: '轻松跑', key: 'E', w: .28, desc: '全程能轻松说话，跑不动就走一段' },
      { day: '周三', rest: true, desc: '休息，可在家里做 10 分钟核心 / 深蹲' },
      { day: '周四', type: '轻松跑', key: 'E', w: .28, desc: '保持呼吸平稳，宁慢勿快' },
      { day: '周五', rest: true, desc: '休息，保证睡眠' },
      { day: '周六', type: '稍长长距离', key: 'E', w: .44, desc: '本周最长的一次，中间可以走停' },
      { day: '周日', rest: true, desc: '休息 / 骑车 / 游泳等交叉训练' }
    ],
    intermediate: [
      { day: '周一', rest: true, desc: '休息 / 拉伸放松' },
      { day: '周二', type: '轻松跑', key: 'E', w: .18, desc: '有氧基础，心率保持在 Z2' },
      { day: '周三', type: '质量课', key: 'T', w: .24, desc: '阈値跑：先热身 1.5km，再持续跑 20 分钟' },
      { day: '周四', type: '恢复跑', key: 'E', w: .14, desc: '比轻松跑更慢，只为促进恢复' },
      { day: '周五', rest: true, desc: '休息，为周末长距离蓄力' },
      { day: '周六', type: '长距离', key: 'E', w: .32, desc: '用轻松跑配速，最后 1/4 可提到马拉松配速' },
      { day: '周日', type: '交叉训练', w: .12, desc: '30 分钟低强度交叉训练（骑车 / 游泳 / 快走），或直接休息' }
    ],
    advanced: [
      { day: '周一', type: '恢复跑', key: 'E', w: .12, desc: '极慢速，30 分钟以内' },
      { day: '周二', type: '间歇跑', key: 'I', w: .20, desc: '例：8 × 800m，组间慢跑 2 分钟' },
      { day: '周三', type: '轻松跑', key: 'E', w: .14, desc: '纯有氧，别加码' },
      { day: '周四', type: '阈値跑', key: 'T', w: .22, desc: '例：4 × 8 分钟阈値，组间慢跑 2 分钟' },
      { day: '周五', rest: true, desc: '休息' },
      { day: '周六', type: '长距离', key: 'E', w: .32, desc: '后半程逐步提到马拉松配速' },
      { day: '周日', rest: true, desc: '休息 / 主动恢复' }
    ]
  };

  function buildPlan(profile, runs, goals, volumeInfo) {
    var level = profile.level || 'intermediate';
    var tpl = TEMPLATES[level] || TEMPLATES.intermediate;
    var downgraded = false, downgradeNote = '';

    // 跑量还没打牢时，先不安排质量课：低跑量下练阈値 / 间歇意义不大，反而容易受伤
    if (level !== 'beginner' && volumeInfo.recommend < 20) {
      tpl = TEMPLATES.beginner;
      downgraded = true;
      downgradeNote = '当前周跑量还不到 20 km，先把有氧基础打牢：本周按"全轻松跑"安排，暂时不加阈値课 / 间歇课。等周跑量稳定在 20 km 以上，再开始上质量课。';
    }

    var anchor = anchorPace(profile, runs, goals);
    var paces = anchor ? Calc.trainingPaces(anchor.pace) : null;
    var paceMap = {};
    if (paces) paces.forEach(function (p) { paceMap[p.key] = p; });

    var total = volumeInfo.recommend;
    var plan = tpl.map(function (t) {
      var km = t.w ? r05(total * t.w) : 0;
      var pace = t.key && paceMap[t.key] ? paceMap[t.key] : null;
      return {
        day: t.day, rest: !!t.rest, type: t.type || '休息', km: km,
        desc: t.desc, pace: pace
      };
    });

    // 质量课节数提示
    var quality = plan.filter(function (d) { return d.type === '质量课' || d.type === '间歇跑' || d.type === '阈値跑'; }).length;

    return {
      plan: plan, anchor: anchor, paces: paces,
      qualityCount: quality, downgraded: downgraded, downgradeNote: downgradeNote,
      totalKm: Calc.round(plan.reduce(function (s, d) { return s + d.km; }, 0), 1)
    };
  }

  /* ---------------- 4. 强度分布 ---------------- */
  function intensitySplit(runs) {
    var since56 = runs.filter(function (r) { return Store.daysBetween(r.date, Store.today()) <= 55; });
    var easy = 0, hard = 0;
    since56.forEach(function (r) {
      if (r.type === 'easy' || r.type === 'recovery' || r.type === 'long') easy += r.distance || 0;
      else hard += r.distance || 0;
    });
    var tot = easy + hard;
    if (tot <= 0) return { easy: 80, hard: 20, hasData: false };
    return { easy: Math.round(easy / tot * 100), hard: Math.round(hard / tot * 100), hasData: true, total: Calc.round(tot, 1) };
  }

  /* ---------------- 5. 目标达成分析 ---------------- */
  function goalAnalysis(goals, runs) {
    if (!goals || !goals.length) return null;
    var pred = Calc.racePredict(runs);
    return goals.map(function (g) {
      var p = pred[g.type];
      var predicted = null, predictedFrom = null;
      if (p) { predicted = p.seconds; predictedFrom = p.from; }
      else if (pred['10k']) {
        predicted = Calc.riegel(pred['10k'].seconds, 10, g.distanceKm);
        predictedFrom = pred['10k'].from;
      } else if (pred['5k']) {
        predicted = Calc.riegel(pred['5k'].seconds, 5, g.distanceKm);
        predictedFrom = pred['5k'].from;
      } else if (runs.length) {
        var best = runs.slice().sort(function (a, b) {
          return (a.seconds / Math.pow(a.distance, 1.06)) - (b.seconds / Math.pow(b.distance, 1.06));
        })[0];
        predicted = Calc.riegel(best.seconds, best.distance, g.distanceKm);
        predictedFrom = best;
      }
      var achieved = null, gap = null;
      if (predicted && g.targetSeconds) {
        achieved = Calc.round(g.targetSeconds / predicted * 100, 1);
        gap = predicted - g.targetSeconds; // 正数=还需加快
      }
      return {
        goal: g, predicted: predicted, predictedFrom: predictedFrom,
        achieved: achieved, gap: gap
      };
    });
  }

  /* ---------------- 6. 饮食推荐 ---------------- */
  function dietGoalType(profile, bodyEval, goals) {
    var bmiVal = bodyEval && bodyEval.metrics ? bodyEval.metrics.bmi : null;
    var bf = bodyEval && bodyEval.metrics ? bodyEval.metrics.bodyFat : null;
    if (Calc.isNum(bmiVal) && bmiVal >= 24) return 'cut';
    if (Calc.isNum(bmiVal) && bmiVal < 18.5) return 'gain';
    if (Calc.isNum(bf)) {
      if (profile.gender === 'female' ? bf >= 30 : bf >= 22) return 'cut';
      if (profile.gender === 'female' ? bf < 16 : bf < 8) return 'gain';
    }
    if (goals && goals.length) {
      // 有成绩目标 → 以运动表现为导向
      return 'perform';
    }
    return 'maintain';
  }

  function dietPlan(profile, bodyEval, runs, goals) {
    var type = dietGoalType(profile, bodyEval, goals);
    var bmrV = Calc.bmr(profile);
    var tdeeV = Calc.tdee(profile);
    if (!bmrV || !tdeeV) {
      return { ok: false, reason: '需要先填写身高、体重、年龄，才能计算每日热量与营养配比。' };
    }
    // 训练消耗：约 1 kcal / kg / km
    var since7 = runs.filter(function (r) { return Store.daysBetween(r.date, Store.today()) <= 6; });
    var kmWeek = Calc.totalKm(since7);
    var w = profile.weight;
    var trainKcalWeek = kmWeek * w * 1.0;
    var trainKcalDay = Math.round(trainKcalWeek / 7);

    var typeText = { cut: '减脂', gain: '增重 / 增肌', perform: '提升运动表现', maintain: '维持体重' }[type];
    var target = tdeeV + trainKcalDay;
    var adjust = 0;
    if (type === 'cut') adjust = -Math.min(450, Math.max(250, target * 0.15));
    else if (type === 'gain') adjust = 250;
    target = Math.round(target + adjust);
    // 安全下限
    var floor = Math.round(bmrV * 1.05);
    var floored = false;
    if (target < floor) { target = floor; floored = true; }

    // 三大营养素
    var proteinPerKg = type === 'cut' ? 2.0 : type === 'gain' ? 1.8 : type === 'perform' ? 1.7 : 1.5;
    var protein = Math.round(w * proteinPerKg);
    var fat = Math.round(w * 0.9);
    if (fat * 9 > target * 0.32) fat = Math.round(target * 0.30 / 9);
    if (fat * 9 < target * 0.18) fat = Math.round(target * 0.20 / 9);
    var carbs = Math.round((target - protein * 4 - fat * 9) / 4);
    if (carbs < 100) carbs = 100;

    var recalc = protein * 4 + fat * 9 + carbs * 4;

    // 训练日 / 休息日碳水微调
    var carbsTrainDay = Math.round(carbs * 1.12);
    var carbsRestDay = Math.round(carbs * 0.88);

    // 三餐 + 加餐分配
    var pct = [
      { name: '早餐', ico: '🌅', p: .25 },
      { name: '午餐', ico: '🍚', p: .30 },
      { name: '训练前加餐', ico: '🍌', p: .10 },
      { name: '晚餐', ico: '🥗', p: .25 },
      { name: '训练后 / 睡前', ico: '🥛', p: .10 }
    ];

    var mealLib = mealLibrary(type, w);
    var meals = pct.map(function (m, i) {
      return {
        name: m.name, ico: m.ico,
        kcal: Math.round(target * m.p),
        items: mealLib[i]
      };
    });

    // 补水
    var water = Math.round(w * 33 / 100) * 100; // ml/天 取整到百
    var runWater = '跑步时每 20 分钟补水 150-250 ml，超过 60 分钟的跑步建议补充含电解质饮料。';

    // 关键提示
    var notes = [];
    if (type === 'cut') {
      notes.push('减脂核心是"热量缺口 + 高蛋白"，不要靠不吃饭来减，那样会掉肌肉、也会跑不动。');
      notes.push('每周减重 0.3-0.5 kg 是安全速度；掉得太快通常意味着掉的是水和肌肉。');
      notes.push('训练后 30-60 分钟内补充蛋白质 + 碳水（如牛奶 + 香蕉），能明显减少肌肉流失。');
    } else if (type === 'gain') {
      notes.push('增重比减脂更耗耐心：每天多加 250 kcal 左右，优先用坚果、牛奶、鸡蛋来加，而不是奶茶炸串。');
      notes.push('搭配力量训练，增加的体重才会更多是肌肉而不是脂肪。');
    } else if (type === 'perform') {
      notes.push('有成绩目标时，碳水是你的第一燃料：训练日的碳水要比休息日多。');
      notes.push('长距离跑前一晚多吃米饭 / 面条，跑前 2 小时吃易消化碳水（香蕉、面包）。');
    } else {
      notes.push('目前体重适中，保持均衡饮食即可，重点是把三餐吃规律。');
    }
    notes.push('跑前 2 小时内不要吃大量高纤维 / 高油食物，容易岔气和胃肠不适。');
    notes.push('每晚保证 7 小时以上睡眠，恢复做不好，吃再好也白搭。');
    if (floored) notes.push('提醒：按公式算出的热量低于你的基础代谢，已自动上调到安全线，不要吃得更少了。');

    // 比赛补给
    var raceTips = [
      '赛前 3 天开始"碳水加载"：把主食量增加 30-50%，同时减少高纤维食物。',
      '比赛当天提前 3 小时吃早餐（面包 / 粥 + 香蕉），赛前 1 小时可补一根能量胶。',
      '半马距离建议每 5km 补水一次；全马从 10km 起每 30-40 分钟补一支能量胶。',
      '绝对不要在比赛日尝试没吃过的新食物 / 新装备。'
    ];

    return {
      ok: true, type: type, typeText: typeText,
      bmr: bmrV, tdee: tdeeV, trainKcalDay: trainKcalDay, kmWeek: Calc.round(kmWeek, 1),
      target: target, recalc: recalc, floored: floored,
      protein: protein, fat: fat, carbs: carbs,
      carbsTrainDay: carbsTrainDay, carbsRestDay: carbsRestDay,
      proteinPerKg: proteinPerKg,
      pPct: Math.round(protein * 4 / recalc * 100),
      fPct: Math.round(fat * 9 / recalc * 100),
      cPct: Math.round(carbs * 4 / recalc * 100),
      meals: meals, water: water, runWater: runWater,
      notes: notes, raceTips: raceTips
    };
  }

  /* 按体重分级给出具体食物份量 */
  function mealLibrary(type, w) {
    var s = w < 55 ? 0 : w < 70 ? 1 : 2; // 份量档位
    var gram = function (base) {
      var mult = [0.85, 1, 1.2][s];
      return Math.round(base * mult / 5) * 5;
    };
    return [
      /* 早餐 */
      [
        '全麦面包 ' + gram(70) + ' g 或 燕麦 ' + gram(50) + ' g',
        '鸡蛋 2 个（水煮 / 少油煎）',
        '牛奶或无糖豆浆 300 ml',
        '水果 1 份（约 200 g，香蕉 / 蓝莓 / 苹果）'
      ],
      /* 午餐 */
      [
        '主食：米饭 / 杂粮饭 ' + gram(180) + ' g（约一碗半）',
        '优质蛋白：鸡胸 / 牛肉 / 鱼 ' + gram(150) + ' g',
        '蔬菜：清炒或白灼 300 g 以上，两种以上颜色',
        '烹饪用油控制在 1 汤匙（10 g）以内'
      ],
      /* 训练前加餐 */
      [
        '跑前 1-2 小时：香蕉 1 根 + 苏打饼干 2 片',
        '或 面包 1 片 + 蜂蜜少许',
        '跑前 30 分钟内若饿，只吃一根香蕉或半支能量胶'
      ],
      /* 晚餐 */
      [
        '主食：红薯 / 玉米 / 米饭 ' + gram(150) + ' g（训练日可多一点）',
        '蛋白：鸡蛋 / 豆腐 / 虾 / 鸡腿肉 ' + gram(120) + ' g',
        '蔬菜：一大盘（至少 300 g）',
        '睡前如饿：无糖酸奶 150 g 或 一小把坚果（20 g）'
      ],
      /* 训练后 / 睡前 */
      [
        '跑后 30-60 分钟内：牛奶 300 ml + 香蕉 1 根（黄金组合）',
        '或 无糖酸奶 200 g + 燕麦 30 g',
        '睡前 1 小时避免大量进食，可喝 200 ml 温牛奶助眠'
      ]
    ];
  }

  /* ---------------- 7. 小助手文案库 ---------------- */
  function tips(profile, bodyEval, runs) {
    var t = [];
    t.push('跑前热身 8 分钟、跑后拉伸 5 分钟，能挡掉大部分小伤小痛。');
    t.push('轻松跑就要真的慢下来，能正常聊天的强度才是有氧训练。');
    t.push('周跑量每周增幅别超过 10%，这条规则能救你很多次。');
    t.push('跑二休一不是偷懒，恢复时身体才在变强。');
    t.push('如果今天实在跑不动，快走 30 分钟也比躺着好。');
    t.push('鞋跑了 600-800 公里就该换了，中底塌了最容易伤膝。');
    t.push('跑后补水别只喝白水，加点电解质更解渴。');
    t.push('步频提到 175-180 步/分，落地点更靠近身体重心，膝盖更省力。');
    t.push('比赛前 3 天开始加碳水，比赛当天千万别尝新食物。');
    t.push('把目标写下来，比只在脑子里想，达成率高很多。');
    t.push('睡眠是最好的补剂，7 小时以下的睡眠会让训练效果打折。');
    t.push('配速不是每天都要拼，80% 的跑量应该跑得很轻松。');

    if (bodyEval) {
      var m = bodyEval.metrics || {};
      if (Calc.isNum(m.bmi) && m.bmi >= 24) t.push('体重每下降 1 kg，全马成绩大约能快 3 分钟，慢慢来。');
      if (Calc.isNum(m.restHR) && m.restHR > 72) t.push('静息心率偏高时，优先补觉，别硬加训练量。');
      if (Calc.isNum(m.weeklyAvgKm) && m.weeklyAvgKm < 10) t.push('先别管配速，把每周跑量稳稳提到 15 km 更管用。');
    }
    if (runs && runs.length >= 5) t.push('连续记录是进步最快的秘诀，你已经坚持得很好了。');
    return t;
  }

  function encouragements() {
    return [
      '今天也要好好跑呀 🏃',
      '慢慢来，比较快。',
      '不用每次都拼尽全力，坚持本身就很了不起。',
      '你已经比昨天的自己更好了。',
      '跑步是最诚实的运动，付出就一定会有回报。',
      '累了就休息，但别放弃。',
      '每一次出门，都是在给未来的自己投资。',
      '配速会迟到的，但不会缺席。',
      '今天的一小步，就是比赛那天的一大步。',
      '风雨里跑过的人，才知道晴天有多好。'
    ];
  }

  function readBody(runs, date) {
    var list = runs.filter(function (r) { return r.date === date; });
    if (!list.length) return null;
    var km = Calc.totalKm(list);
    var sec = list.reduce(function (s, r) { return s + r.seconds; }, 0);
    var pace = sec / km;
    return { km: km, sec: sec, pace: pace, count: list.length, runs: list };
  }

  return {
    recommendVolume: recommendVolume,
    anchorPace: anchorPace,
    buildPlan: buildPlan,
    intensitySplit: intensitySplit,
    goalAnalysis: goalAnalysis,
    dietPlan: dietPlan,
    dietGoalType: dietGoalType,
    tips: tips,
    encouragements: encouragements,
    readBody: readBody
  };
})();
