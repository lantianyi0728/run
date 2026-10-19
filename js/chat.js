/* ============================================================
   chat.js — 小助手「小跑」的对话大脑
   纯本地、离线运行：所有回答都基于你自己记录的真实数据
   （身体档案 / 跑步记录 / 目标 / 打卡），不联网、不上传。
   ============================================================ */

var Chat = (function () {

  var weatherProvider = null;

  function setWeatherProvider(fn) { weatherProvider = fn; }

  function plain(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

  /* ---------------- 上下文 ---------------- */
  function context() {
    var p = Store.getProfile();
    var runs = Store.getRuns();
    var goals = Store.getGoals();
    var checkins = Store.getCheckins();
    var ev = Calc.evaluateBody(p, runs, checkins);
    var vol = Coach.recommendVolume(p, runs, goals);
    var plan = Coach.buildPlan(p, runs, goals, vol);
    var diet = Coach.dietPlan(p, ev, runs, goals);
    var pred = Calc.racePredict(runs);
    var weekStart = Calc.weeklySeries(runs, 1)[0].from;
    var calWeek = Calc.totalKm(runs.filter(function (r) { return r.date >= weekStart; }));
    return {
      p: p, runs: runs, goals: goals, checkins: checkins,
      ev: ev, vol: vol, plan: plan, diet: diet, pred: pred,
      weekStart: weekStart, calWeekKm: calWeek,
      today: Store.today()
    };
  }

  function hasBody(c) {
    return Calc.isNum(c.p.height) && Calc.isNum(c.p.weight);
  }
  function needBody() {
    return { ico: '📝', text: '这块我需要你的身高体重才能算。去「身体档案」填一下（30 秒的事），我马上就能给你答案。' };
  }

  function lastRunLine(r) {
    return r.date + ' 跑了 ' + r.distance + ' km，用时 ' + Calc.fmtDur(r.seconds) +
      '，配速 ' + Calc.fmtPaceUnit(r.seconds / r.distance) +
      (r.hr ? '，平均心率 ' + r.hr : '') + '。';
  }

  /* ---------------- 各意图回答 ---------------- */
  var H = {};

  H.greet = function (c) {
    var h = new Date().getHours();
    var when = h < 5 ? '这么晚还没睡' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    var tips = ['你可以问我「这周跑了多少」「我该怎么练」「今天适合跑步吗」「我该吃什么」。'];
    return { ico: '👋', text: when + '，' + (c.p.name || '跑者') + '！' + tips[0] };
  };

  H.help = function () {
    return {
      ico: '🙋', text: '我能基于你自己的数据回答这些问题：\n' +
        '· 跑量：「这周跑了多少」「累计跑了多少」\n' +
        '· 状态：「我的身体状态怎么样」「最近状态分析一下」\n' +
        '· 目标：「我的目标还差多少」「多久能达成」\n' +
        '· 训练：「我该怎么练」「跑量该加到多少」「我的心率区间」\n' +
        '· 吃穿：「我该吃什么」「今天适合跑步吗」「膝盖疼怎么办」\n' +
        '直接打字问我就行，不用讲究措辞。'
    };
  };

  H.today = function (c) {
    var rs = c.runs.filter(function (r) { return r.date === c.today; });
    if (!rs.length) {
      var s = Store.currentStreak();
      return {
        ico: '🌤️', text: '今天还没跑。' + (s >= 2 ? '你已经连续打卡 ' + s + ' 天了，别断在这天呀 🔥' : '今天动一动，20 分钟也算数。') +
          ' 想知道今天适不适合出门，可以问我「今天适合跑步吗」。'
      };
    }
    var km = Calc.totalKm(rs);
    var sec = rs.reduce(function (a, r) { return a + r.seconds; }, 0);
    return {
      ico: '🏃', text: '今天跑了 ' + km + ' km，用时 ' + Calc.fmtDur(sec) + '，平均配速 ' + Calc.fmtPaceUnit(sec / km) +
        '。' + (km >= 10 ? '这个量不小，记得补蛋白质、早点睡。' : '不错，保持了节奏。')
    };
  };

  H.week_volume = function (c) {
    if (!c.runs.length) return { ico: '📊', text: '还没有任何跑步记录。记录第一次之后，我就能告诉你周跑量的变化趋势了。' };
    var w = Store.runsSince(7);
    var km = Calc.totalKm(w);
    var avg = Calc.avgPaceOf(w);
    var prevFrom = Store.addDays(c.today, -13), prevTo = Store.addDays(c.today, -7);
    var prev = Calc.totalKm(c.runs.filter(function (r) { return r.date >= prevFrom && r.date <= prevTo; }));
    var cmp = '';
    if (prev > 0) {
      var d = km - prev;
      cmp = ' 和上一周比' + (Math.abs(d) < 1 ? '基本持平' : (d > 0 ? '多了 ' + Calc.round(d, 1) + ' km ↗' : '少了 ' + Calc.round(-d, 1) + ' km ↘')) + '。';
    }
    return {
      ico: '📊', text: '近 7 天你跑了 ' + km + ' km，共 ' + w.length + ' 次' +
        (avg ? '，平均配速 ' + Calc.fmtPaceUnit(avg) : '') + '。' + cmp +
        ' 本周（周一起算）目前是 ' + c.calWeekKm + ' km。'
    };
  };

  H.month_volume = function (c) {
    var m = c.today.slice(0, 7);
    var mr = c.runs.filter(function (r) { return r.date.slice(0, 7) === m; });
    var km = Calc.totalKm(mr);
    return {
      ico: '📅', text: '本月（' + (+m.slice(5)) + ' 月）你已经跑了 ' + km + ' km，共 ' + mr.length + ' 次，平均每次 ' +
        (mr.length ? Calc.round(km / mr.length, 1) : 0) + ' km。'
    };
  };

  H.total_volume = function (c) {
    if (!c.runs.length) return { ico: '🏆', text: '还没有记录。从第一次开始算，跑过的每一步我都会帮你攒着。' };
    var first = c.runs[c.runs.length - 1].date;
    return {
      ico: '🏆', text: '你一共记录了 ' + c.runs.length + ' 次跑步，累计 ' + Calc.totalKm(c.runs) + ' km。' +
        '最早一条是 ' + first + '，已经坚持 ' + Store.daysBetween(first, c.today) + ' 天了。'
    };
  };

  H.last_run = function (c) {
    if (!c.runs.length) return { ico: '🤔', text: '还没有跑步记录，先在「跑步记录」里加一条吧。' };
    var r = c.runs[0];
    var t = { easy: '轻松跑', tempo: '节奏跑', interval: '间歇跑', long: '长距离', race: '比赛/测试', recovery: '恢复跑' }[r.type] || '跑步';
    return {
      ico: '🏃', text: '最近一次是 ' + lastRunLine(r) + '类型是' + t + '。' +
        (r.note ? '你当时的备注是「' + r.note + '」。' : '') +
        ' 距今 ' + Store.daysBetween(r.date, c.today) + ' 天。'
    };
  };

  H.pace = function (c) {
    if (!c.runs.length) return { ico: '⏱️', text: '还没有跑步记录，记一次我就知道你的配速水平了。' };
    var w = Store.runsSince(30);
    var src = w.length ? w : c.runs;
    var avg = Calc.avgPaceOf(src);
    var fastest = src.slice().sort(function (a, b) {
      return (a.seconds / a.distance) - (b.seconds / b.distance);
    })[0];
    var fp = fastest.seconds / fastest.distance;
    var series = Calc.paceSeries(c.runs, 30);
    var trend = Calc.paceTrend(series);
    var trendTxt = series.length < 3 ? '' :
      trend < -1.5 ? ' 近 30 天配速在稳步变快，趋势很好 📈' :
        trend > 1.5 ? ' 近 30 天配速略有放慢，可能是跑量上去了或者状态没恢复，正常现象。' :
          ' 近 30 天配速比较稳定。';
    return {
      ico: '⏱️', text: '近 30 天平均配速 ' + Calc.fmtPaceUnit(avg) +
        '；最快的一次是 ' + fastest.date + ' 的 ' + fastest.distance + ' km，配速 ' + Calc.fmtPaceUnit(fp) + '。' + trendTxt
    };
  };

  H.best = function (c) {
    if (!c.runs.length) return { ico: '🥇', text: '还没有记录，先跑一次吧。' };
    var keys = Object.keys(c.pred);
    if (!keys.length) return { ico: '🥇', text: '记录还太少，多跑几次我就能预测你的各项最好成绩了。' };
    var lines = ['3k', '5k', '10k', 'half', 'full'].filter(function (k) { return c.pred[k]; })
      .map(function (k) { return c.pred[k].label + ' 约 ' + Calc.fmtDur(c.pred[k].seconds); });
    return {
      ico: '🥇', text: '按你最近的跑步记录推算：\n' + lines.join('\n') +
        '\n（用 Riegel 公式外推，距离越远误差越大，仅供参考）'
    };
  };

  H.body = function (c) {
    if (!hasBody(c)) return needBody();
    var ev = c.ev;
    var weak = ev.items.filter(function (i) { return i.score !== null && i.score < 70; });
    var txt = '身体状态评分 ' + ev.score + ' 分（' + ev.level + '）。';
    if (weak.length) {
      txt += '目前偏弱的是：' + weak.map(function (i) { return i.name + '（' + i.value + '）'; }).join('、') + '。';
    } else {
      txt += '各项指标都在健康区间，保持得不错。';
    }
    txt += ' ' + ev.advice[0];
    return { ico: '❤️', text: txt };
  };

  H.analyse = function (c) {
    if (!c.runs.length) return { ico: '🔍', text: '还没有数据可以分析。先记录几次跑步，我就能给你一份评价了。' };
    var w = Calc.runsSince(28);
    var km = Calc.totalKm(w);
    var avgPace = Calc.avgPaceOf(w);
    var split = Coach.intensitySplit(c.runs);
    var series = Calc.paceSeries(c.runs, 30);
    var trend = Calc.paceTrend(series);
    var txt = '近 4 周你跑了 ' + km + ' km（' + w.length + ' 次）' +
      (avgPace ? '，平均配速 ' + Calc.fmtPaceUnit(avgPace) : '') + '。';
    txt += trend < -1.5 ? '配速在变快，' : trend > 1.5 ? '配速略有放慢，' : '配速稳定，';
    txt += split.hasData
      ? (split.easy >= 75 ? '低强度占比 ' + split.easy + '%，强度分配很健康。' : '低强度只占 ' + split.easy + '%，建议把轻松跑的比例提到 75% 以上。')
      : '';
    if (hasBody(c)) txt += ' 综合评分 ' + c.ev.score + ' 分。';
    txt += ' ' + c.ev.advice[0];
    return { ico: '🔍', text: txt };
  };

  H.goal = function (c) {
    if (!c.goals.length) {
      return { ico: '🎯', text: '你还没设目标。设一个吧，比如「5 公里跑进 25 分」——有目标之后，我给的训练建议会具体很多。去「目标设定」页填一下就行。' };
    }
    var ga = Coach.goalAnalysis(c.goals, c.runs);
    var g = ga[0];
    if (!g.predicted) {
      return { ico: '🎯', text: '你的目标是「' + g.goal.label + ' 跑进 ' + Calc.fmtDur(g.goal.targetSeconds) + '」。现在记录还太少，多跑几次我就能算出你离目标还有多远。' };
    }
    var gap = g.gap;
    if (gap === null) return { ico: '🎯', text: '目标已设定：' + g.goal.label + ' ' + Calc.fmtDur(g.goal.targetSeconds) + '。' };
    if (gap <= 0) {
      return { ico: '🎉', text: '你已经达到「' + g.goal.label + ' ' + Calc.fmtDur(g.goal.targetSeconds) + '」了！（当前预测 ' + Calc.fmtDur(g.predicted) + '）可以考虑设一个更有挑战的新目标。' };
    }
    var perKm = Math.round(gap / g.goal.distanceKm);
    var weeks = Math.max(4, Math.ceil(gap / 8));
    return {
      ico: '🎯', text: '目标：' + g.goal.label + ' 跑进 ' + Calc.fmtDur(g.goal.targetSeconds) + '。' +
        '按最近记录推算你现在大概 ' + Calc.fmtDur(g.predicted) + '，还差 ' + Calc.fmtDur(gap) +
        '，约等于每公里快 ' + perKm + ' 秒。按现在每周 ' + c.vol.recommend + ' km 的节奏，' + weeks + '-12 周比较现实，别急。'
    };
  };

  H.train = function (c) {
    var pl = c.plan;
    var parts = pl.plan.filter(function (d) { return !d.rest && d.km > 0; })
      .map(function (d) { return d.day.replace('周', '') + ' ' + d.type + ' ' + d.km + 'km' + (d.pace ? '（' + Calc.fmtPace(d.pace.sec) + '）' : ''); });
    var txt = '这周的课表是：' + parts.join('、') + '，总跑量约 ' + pl.totalKm + ' km。';
    if (pl.downgraded) txt += ' 你目前跑量还不大，先全部跑轻松强度，别急着上阈値和间歇。';
    else txt += ' 记住：80% 的跑量都要跑得很轻松（能正常说话），只有质量课才拼配速。';
    return { ico: '📋', text: txt };
  };

  H.volume_advice = function (c) {
    var v = c.vol;
    var txt = '按你的水平，建议周跑量 ' + v.recommend + ' km（安全区间 ' + v.range[0] + '-' + v.range[1] + ' km）。';
    txt += ' 近 4 周你平均每周 ' + v.current + ' km，';
    if (v.current <= 0.5) txt += '现在等于从零开始，先按每周 3 次、每次 20-30 分钟把习惯建立起来。';
    else if (v.recommend > v.current) txt += '建议每周加 ' + Calc.round(v.recommend - v.current, 1) + ' km 左右，增幅别超过 10%。';
    else txt += '跑量已经够了，先别加，重点放在把轻松跑跑扎实。';
    if (v.reasons.length) txt += ' ' + v.reasons[v.reasons.length - 1];
    return { ico: '📈', text: txt };
  };

  H.heart = function (c) {
    var mhr = Calc.maxHR(c.p.age);
    if (!mhr) return { ico: '💓', text: '我需要你的年龄才能算心率区间。在「身体档案」填一下就可以。' };
    var z = Calc.hrZones(mhr);
    return {
      ico: '💓', text: '按 ' + c.p.age + ' 岁估算，你的最大心率约 ' + mhr + ' 次/分。五个区间：\n' +
        z.map(function (x) { return '· ' + x.name + '：' + x.text; }).join('\n') +
        '\n大部分跑量待在 Z2（' + z[1].text + '），提升最稳也最不容易伤。'
    };
  };

  H.diet = function (c) {
    if (!c.diet.ok) return needBody();
    var d = c.diet;
    var txt = '按你的身体数据算，' + d.typeText + '导向的每日目标是 ' + d.target + ' kcal' +
      '：蛋白质 ' + d.protein + ' g、碳水 ' + d.carbs + ' g（训练日 ' + d.carbsTrainDay + ' g）、脂肪 ' + d.fat + ' g。';
    txt += ' 日常喝水约 ' + d.water + ' ml。' + d.notes[0];
    return { ico: '🍚', text: txt };
  };

  H.weather = function (c, cb) {
    if (!weatherProvider) { cb({ ico: '🌤️', text: '天气暂时查不到，不过出门前热身 8 分钟总是对的。' }); return; }
    weatherProvider(function (w) {
      if (!w) {
        cb({ ico: '🌤️', text: '天气没查到（可能是网络或接口限制）。判断标准很简单：能见度好、不闷不雨就去跑。' });
        return;
      }
      cb({
        ico: w.emoji,
        text: w.city + '现在 ' + w.emoji + ' ' + w.text + '，气温 ' + w.temp + '℃' +
          (w.feels !== w.temp ? '（体感 ' + w.feels + '℃）' : '') +
          (w.tmax !== null ? '，今天 ' + w.tmin + '~' + w.tmax + '℃' : '') + '。' +
          Assistant._weatherAdvice(w)
      });
    });
  };

  H.injury = function (c) {
    return {
      ico: '🩹', text: '跑步疼痛的处理原则：\n' +
        '1. 疼就停 —— 尤其是有明确痛点、按压痛、跑起来越跑越疼的，别硬顶。\n' +
        '2. 前 48 小时冰敷（每次 15 分钟，隔 2 小时），别热敷别揉。\n' +
        '3. 疼痛超过 1 周不缓解，去看运动医学科，别问 AI 也别问跑友。\n' +
        '4. 恢复期可以做游泳、骑车、力量训练维持体能。\n' +
        '最容易被忽略的一条：膝痛、胫骨痛八成是「跑量加太快」造成的，回去看看你的周跑量增幅。'
    };
  };

  H.improve = function (c) {
    var txt = '想变快，顺序不能反：\n' +
      '1. 先把跑量堆起来（你现在建议 ' + c.vol.recommend + ' km/周），有氧底子是配速的地基。\n' +
      '2. 每周加 1 次质量课 —— 阈値跑（20-30 分钟「舒适的痛苦」）提升最直接。\n' +
      '3. 每周 1 次长距离，时间比距离重要。\n' +
      '4. 每周 2 次力量训练，深蹲 + 提踵 + 平板支撑就够。\n' +
      '最大的坑是「每次跑都拼尽全力」—— 那样只会又累又不进步。';
    if (hasBody(c) && c.ev.metrics && Calc.isNum(c.ev.metrics.bmi) && c.ev.metrics.bmi >= 24) {
      txt += ' 另外你体重还有下降空间，每轻 1 kg 全马大约快 3 分钟。';
    }
    return { ico: '🚀', text: txt };
  };

  H.fatloss = function (c) {
    var txt = '跑步减脂的关键不是跑多快，是「跑得久 + 吃得对」：\n';
    txt += '1. 用能聊天的配速跑 40-60 分钟，脂肪供能比例最高，还不容易累。\n';
    txt += '2. 每周 4-5 次，比一次跑很久更有效。\n';
    txt += '3. 饮食上保证高蛋白（你这个体重每天约 ' + (hasBody(c) && c.diet.ok ? c.diet.protein : Math.round((c.p.weight || 65) * 1.8)) + ' g），别靠不吃饭减。\n';
    txt += '4. 每周掉 0.3-0.5 kg 是安全速度，掉太快掉的是肌肉。';
    if (hasBody(c) && c.ev.metrics.bodyFat) txt += ' 你目前体脂 ' + c.ev.metrics.bodyFat + '%。';
    return { ico: '🔥', text: txt };
  };

  H.checkin = function (c) {
    var s = Store.currentStreak();
    var txt = '你已经累计打卡 ' + Store.checkedCount() + ' 天，当前连续 ' + s + ' 天，最长连续 ' + Store.maxStreak() + ' 天。';
    txt += s >= 7 ? ' 连续一周以上了，这已经是习惯而不是坚持了 👏' :
      s >= 3 ? ' 保持住，别断。' : ' 从今天开始，一步一步来。';
    return { ico: '✅', text: txt };
  };

  H.sleep = function (c) {
    var txt = '睡眠是跑步最被低估的一环：';
    if (Calc.isNum(c.p.sleep)) txt += '你目前填的是每天 ' + c.p.sleep + ' 小时，' + (c.p.sleep < 7 ? '偏少。' : '还不错。');
    else txt += '你还没填睡眠时长，可以在「身体档案」补上。';
    txt += ' 睡不够会直接让静息心率升高、配速变慢、受伤风险上升。目标是 7-8 小时，跑量大或质量课之后要更多。';
    return { ico: '😴', text: txt };
  };

  H.warmup = function (c) {
    return {
      ico: '🤸', text: '跑前热身（8-10 分钟）：先快走或慢跑 3-5 分钟让身体热起来，再做动态拉伸 —— 高抬腿、后踢腿、弓步走、髋绕环各 30 秒，最后来 2-3 组 20 秒的加速跑。\n' +
        '跑后放松（5-10 分钟）：先慢跑或走 3 分钟让心率降下来，再静态拉伸小腿、大腿前后侧、髂胫束，每个动作 30 秒别弹震。'
    };
  };

  H.race = function (c) {
    var txt = '备赛要点：';
    if (c.goals.length) {
      var g = c.goals[0];
      txt += '你的目标是 ' + g.label + ' ' + Calc.fmtDur(g.targetSeconds) + '，';
      if (c.pred[g.type]) {
        txt += '当前预测 ' + Calc.fmtDur(c.pred[g.type].seconds) + '。';
      } else txt += '多记录几次我好帮你预测。';
    } else {
      txt += '你还没设比赛目标，可以在「目标设定」里选半马或全马。';
    }
    txt += ' 通用原则：赛前 3 周开始减量（跑量降到 60%、50%、40%），赛前 3 天加碳水，比赛当天提前 3 小时吃早餐，前 5 公里一定要压住速度。';
    return { ico: '🏅', text: txt };
  };

  H.hydration = function (c) {
    var w = hasBody(c) && c.diet.ok ? c.diet.water : Math.round((c.p.weight || 65) * 33 / 100) * 100;
    return {
      ico: '💧', text: '日常每天约 ' + w + ' ml（差不多 ' + Math.round(w / 250) + ' 杯）。跑步时每 20 分钟补 150-250 ml；超过 60 分钟或大量出汗，要喝含电解质的饮料 —— 只喝白水反而可能越喝越没劲。'
    };
  };

  H.fallback = function (c) {
    var s = [
      '这周跑了多少？',
      '我该怎么练？',
      '今天适合跑步吗？',
      '我的目标还差多少？',
      '我的身体状态怎么样？'
    ];
    return {
      ico: '🤔', text: '这个问题我还没学会。我目前最擅长这些：' + s.join('、') +
        '。你也可以直接问我「你能做什么」看看全部能力。'
    };
  };

  /* ---------------- 意图表 ---------------- */
  var INTENTS = [
    { id: 'help', keys: ['你能做什么', '你会什么', '你能帮我', '怎么用', '有什么功能', '使用说明', '帮助'] },
    { id: 'greet', keys: ['你好', '您好', '哈喽', '嗨', 'hello', 'hi', '在吗', '早上好', '晚上好'] },
    { id: 'today', keys: ['今天跑', '今日跑', '今天有没有跑', '今天没跑'] },
    { id: 'week_volume', keys: ['这周', '本周', '这一周', '最近一周', '周跑量', '一周跑'] },
    { id: 'month_volume', keys: ['这个月', '本月', '月度', '这个月跑'] },
    { id: 'total_volume', keys: ['累计', '一共跑', '总共跑', '总计', '全部跑量', '总共多少'] },
    { id: 'last_run', keys: ['最近一次', '上次跑', '最后一次', '最近跑', '刚刚跑'] },
    { id: 'best', keys: ['最好成绩', '最快', '最好能跑', 'pb', '个人最好', '能跑多快'] },
    { id: 'pace', keys: ['配速', '速度怎么样', '跑多快', '快慢', '每公里'] },
    { id: 'analyse', keys: ['分析', '评价一下', '总结', '看看我', '我最近怎么样', '状态分析'] },
    { id: 'body', keys: ['身体状态', '身体状况', '体质', '健康', '身体数据', 'bmi', '体脂'] },
    { id: 'goal', keys: ['目标', '还差多少', '能不能达标', '多久能', '什么时候能', '达成'] },
    { id: 'train', keys: ['怎么练', '训练', '课表', '计划', '怎么跑', '训练方法', '安排'] },
    { id: 'volume_advice', keys: ['跑量', '加量', '该跑多少', '跑多少合适', '周跑量建议'] },
    { id: 'heart', keys: ['心率', '脉搏', '心律'] },
    { id: 'weather', keys: ['天气', '适合跑步吗', '能不能跑', '能跑吗', '今天跑吗', '下雨', '气温', '热不热', '冷不冷', '雾霾', '空气'] },
    { id: 'diet', keys: ['吃什么', '饮食', '营养', '食谱', '吃', '热量', '卡路里', '蛋白质', '碳水'] },
    { id: 'hydration', keys: ['喝水', '补水', '水分', '喝多少水', '喝多少', '多少水', '饮水', '一天喝'] },
    { id: 'injury', keys: ['疼', '受伤', '拉伤', '膝盖', '脚踝', '酸痛', '不适', '伤了'] },
    { id: 'improve', keys: ['提高配速', '提升配速', '配速提高', '配速提升', '跑得更快', '提高', '进步', '变快', '突破', '瓶颈', '提速'] },
    { id: 'fatloss', keys: ['减肥', '减脂', '瘦', '降体重', '体重下降', '掉秤'] },
    { id: 'sleep', keys: ['睡眠', '睡觉', '熬夜', '睡不够'] },
    { id: 'warmup', keys: ['热身', '拉伸', '准备活动', '放松', '恢复跑怎么做'] },
    { id: 'race', keys: ['比赛', '马拉松', '半马', '全马', '参赛', '赛前', '比赛日'] },
    { id: 'checkin', keys: ['打卡', '连续几天', '坚持多少天', '连续'] }
  ];

  function matchIntent(q) {
    var best = null, bestScore = 0;
    for (var i = 0; i < INTENTS.length; i++) {
      var it = INTENTS[i], s = 0;
      for (var j = 0; j < it.keys.length; j++) {
        var k = plain(it.keys[j]);
        if (k && q.indexOf(k) >= 0) s += Math.max(2, k.length * 1.5);
      }
      if (s > bestScore) { bestScore = s; best = it; }
    }
    return bestScore >= 3 ? best.id : 'fallback';
  }

  /* ---------------- 入口 ---------------- */
  // 处理器有两种风格：① 直接 return {ico,text}（同步）
  //                    ② 接收 cb 并异步回调（天气查询）
  // 这里统一兼容，避免漏答。
  function ask(question, cb) {
    var q = plain(question);
    if (!q) { cb({ ico: '💬', text: '想问我什么？', intent: 'fallback' }); return; }
    var id = matchIntent(q) || 'fallback';
    var c = context();
    var fn = H[id] || H.fallback;
    var done = false;
    var respond = function (res) {
      if (done) return;
      done = true;
      if (!res || typeof res.text !== 'string') {
        res = { ico: '💬', text: '我没想好怎么回答，换个说法试试？' };
      }
      res.intent = id;             // 让双智能体知道这句话属于哪一类
      cb(res);
    };
    var ret = fn(c, respond);
    if (ret && typeof ret === 'object' && typeof ret.text === 'string') respond(ret);
  }

  function suggestions(c) {
    c = c || context();
    var out = [];
    if (!c.runs.length) {
      out.push('你能做什么');
      out.push('我该怎么练');
      out.push('今天适合跑步吗');
      return out;
    }
    if (!Store.isChecked(c.today)) out.push('今天跑了多少');
    out.push('这周跑了多少');
    out.push('我该怎么练');
    if (c.goals.length) out.push('我的目标还差多少');
    else out.push('我的身体状态怎么样');
    out.push('今天适合跑步吗');
    out.push('我该吃什么');
    return out.slice(0, 5);
  }

  return {
    ask: ask,
    suggestions: suggestions,
    setWeatherProvider: setWeatherProvider,
    _matchIntent: matchIntent,
    _context: context
  };
})();
