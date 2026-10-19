/* ============================================================
   agentbus.js — 双智能体的神经中枢
   ------------------------------------------------------------
   三个职责：
   1. 共享上下文：两个智能体永远看同一份数据快照，
      不会出现「教练说 21km、搭子说 19km」这种打脸。
   2. 信箱（inbox）：智能体之间真的能互相说话。
      教练把结论塞进搭子的信箱，搭子必须回应它。
   3. 事件总线：记录跑步 / 打卡 / 改目标 / 换身体数据
      都从这里广播出去，后台会诊靠它触发。
   ============================================================ */

var AgentBus = (function () {

  var handlers = {};
  var inboxes = { coach: [], buddy: [] };
  var trace = [];
  var snap = null;
  var MAX_TRACE = 200;

  /* ---------------- 事件总线 ---------------- */
  function on(evt, fn) {
    if (!handlers[evt]) handlers[evt] = [];
    if (handlers[evt].indexOf(fn) >= 0) return function () { };
    handlers[evt].push(fn);
    return function () { off(evt, fn); };
  }
  function off(evt, fn) {
    var a = handlers[evt];
    if (!a) return;
    var i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  function emit(evt, data) {
    var a = handlers[evt];
    if (!a) return;
    a.slice().forEach(function (fn) {
      try { fn(data); } catch (e) { /* 一个监听器出错不影响其他 */ }
    });
  }

  /* ---------------- 智能体之间的信箱 ---------------- */
  function send(from, to, text, meta) {
    if (!inboxes[to]) return null;
    var msg = { from: from, to: to, text: String(text || ''), meta: meta || {}, ts: Date.now() };
    inboxes[to].push(msg);
    record(from, msg.text, 'mail');
    emit('mail', msg);
    return msg;
  }
  function read(agent) {
    var list = inboxes[agent] || [];
    inboxes[agent] = [];
    return list;
  }
  function peek(agent) { return (inboxes[agent] || []).slice(); }
  function pending(agent) { return (inboxes[agent] || []).length; }

  /* ---------------- 对话轨迹（谁对谁说了什么） ---------------- */
  function record(who, text, kind) {
    trace.push({ who: who, text: String(text || ''), kind: kind || 'say', ts: Date.now() });
    if (trace.length > MAX_TRACE) trace.shift();
  }
  function history(n) { return n ? trace.slice(-n) : trace.slice(); }

  /* ---------------- 共享数据快照 ---------------- */
  function invalidate() { snap = null; }

  function build() {
    var c = Chat._context();
    var today = c.today;
    var w7 = Store.runsSince(7);
    var km7 = Calc.totalKm(w7);
    var prevFrom = Store.addDays(today, -13);
    var prevTo = Store.addDays(today, -7);
    var kmPrev = Calc.totalKm(c.runs.filter(function (r) {
      return r.date >= prevFrom && r.date <= prevTo;
    }));
    var deltaPct = kmPrev > 0.5 ? Math.round((km7 - kmPrev) / kmPrev * 100) : null;
    var last = c.runs[0] || null;
    var split = Coach.intensitySplit(c.runs);
    var monthKm = Calc.totalKm(c.runs.filter(function (r) {
      return r.date.slice(0, 7) === today.slice(0, 7);
    }));

    var hardDays7 = 0, i;
    for (i = 0; i < c.runs.length; i++) {
      if (Store.daysBetween(c.runs[i].date, today) > 6) break;
      if (c.runs[i].type !== 'easy' && c.runs[i].type !== 'recovery') hardDays7++;
    }

    var g = null;
    if (c.goals.length) {
      var ga = Coach.goalAnalysis(c.goals, c.runs);
      if (ga && ga.length) {
        g = {
          label: ga[0].goal.label,
          target: ga[0].goal.targetSeconds,
          type: ga[0].goal.type,
          distanceKm: ga[0].goal.distanceKm,
          predicted: ga[0].predicted,
          gap: ga[0].gap,
          achieved: ga[0].achieved
        };
      }
    }

    var p = c.p;
    return {
      today: today,
      name: p.name || '跑者',
      hasBody: Calc.isNum(p.height) && Calc.isNum(p.weight),
      profile: {
        age: Calc.isNum(p.age) ? +p.age : null,
        height: Calc.isNum(p.height) ? +p.height : null,
        weight: Calc.isNum(p.weight) ? +p.weight : null,
        gender: p.gender || '',
        sleep: Calc.isNum(p.sleep) ? +p.sleep : null
      },
      weekKm: km7,
      weekRuns: w7.length,
      prevWeekKm: kmPrev,
      deltaPct: deltaPct,
      calWeekKm: c.calWeekKm,
      monthKm: monthKm,
      totalKm: Calc.totalKm(c.runs),
      totalRuns: c.runs.length,
      avgPace30: Calc.avgPaceOf(Store.runsSince(30)),
      lastRun: last ? {
        date: last.date,
        distance: last.distance,
        seconds: last.seconds,
        pace: last.seconds / last.distance,
        type: last.type,
        hr: last.hr || null,
        rpe: last.rpe || null,
        note: last.note || ''
      } : null,
      gapDays: last ? Store.daysBetween(last.date, today) : null,
      streak: Store.currentStreak(),
      maxStreak: Store.maxStreak(),
      checkedToday: Store.isChecked(today),
      body: (c.ev && Calc.isNum(c.ev.score)) ? {
        score: c.ev.score,
        level: c.ev.level,
        weak: (c.ev.items || []).filter(function (x) {
          return x.score !== null && x.score < 70;
        }).map(function (x) { return x.name; }),
        advice: (c.ev.advice || []).slice(0, 2)
      } : null,
      goal: g,
      volume: {
        recommend: c.vol.recommend,
        range: c.vol.range,
        current: c.vol.current
      },
      plan: {
        totalKm: c.plan.totalKm,
        downgraded: !!c.plan.downgraded,
        days: (c.plan.plan || []).filter(function (d) { return !d.rest && d.km > 0; })
          .map(function (d) { return d.day + ' ' + d.type + ' ' + d.km + 'km'; })
      },
      intensity: split,
      hardDays7: hardDays7,
      predict: Object.keys(c.pred || {}).map(function (k) {
        return c.pred[k].label + ' ' + Calc.fmtDur(c.pred[k].seconds);
      }),
      diet: (c.diet && c.diet.ok) ? {
        target: c.diet.target,
        protein: c.diet.protein,
        carbs: c.diet.carbs,
        water: c.diet.water,
        typeText: c.diet.typeText
      } : null,
      recentRuns: c.runs.slice(0, 6).map(function (r) {
        return r.date + ' ' + r.distance + 'km ' + Calc.fmtDur(r.seconds) +
          ' ' + Calc.fmtPaceUnit(r.seconds / r.distance) + ' ' + (r.type || 'run');
      })
    };
  }

  function data() {
    if (!snap) snap = build();
    return snap;
  }

  /* 给大模型看的「事实台账」：一行一条，全是算好的真实数字 */
  function text() {
    var d = data();
    var L = [];
    L.push('日期：' + d.today + '，称呼：' + d.name);
    if (d.hasBody) {
      L.push('身体：身高 ' + d.profile.height + ' cm，体重 ' + d.profile.weight + ' kg' +
        (d.profile.age ? '，' + d.profile.age + ' 岁' : ''));
    } else {
      L.push('身体：未填写身高体重，无法计算 BMI / 体脂 / 热量');
    }
    L.push('近 7 天：' + d.weekKm + ' km / ' + d.weekRuns + ' 次' +
      (d.deltaPct !== null
        ? '（比上一个 7 天 ' + (d.deltaPct >= 0 ? '+' : '') + d.deltaPct + '%）'
        : '（上一周没有可比数据）'));
    L.push('本周（周一起）：' + d.calWeekKm + ' km；本月：' + d.monthKm + ' km；' +
      '累计：' + d.totalKm + ' km / ' + d.totalRuns + ' 次');
    if (d.avgPace30) L.push('近 30 天平均配速：' + Calc.fmtPaceUnit(d.avgPace30) + '/km');
    if (d.lastRun) {
      L.push('最近一次：' + d.lastRun.date + '，' + d.lastRun.distance + ' km，' +
        '配速 ' + Calc.fmtPaceUnit(d.lastRun.pace) + '，类型 ' + d.lastRun.type +
        (d.lastRun.hr ? '，心率 ' + d.lastRun.hr : '') +
        (d.lastRun.rpe ? '，RPE ' + d.lastRun.rpe : '') +
        '，距今 ' + d.gapDays + ' 天');
    } else {
      L.push('跑步记录：还没有任何记录');
    }
    L.push('打卡：连续 ' + d.streak + ' 天（最长 ' + d.maxStreak + ' 天），今天' +
      (d.checkedToday ? '已打卡' : '还没打卡'));
    if (d.body) {
      L.push('身体评分：' + d.body.score + ' 分（' + d.body.level + '）' +
        (d.body.weak.length ? '，偏弱项：' + d.body.weak.join('、') : ''));
    }
    L.push('建议周跑量：' + d.volume.recommend + ' km（安全区间 ' + d.volume.range[0] +
      '-' + d.volume.range[1] + ' km），近 4 周实际周均 ' + d.volume.current + ' km');
    if (d.intensity.hasData) {
      L.push('近 8 周强度分配：轻松跑 ' + d.intensity.easy + '% / 强度课 ' + d.intensity.hard +
        '%；近 7 天强度课 ' + d.hardDays7 + ' 次');
    }
    if (d.goal) {
      L.push('目标：' + d.goal.label + ' 跑进 ' + Calc.fmtDur(d.goal.target) +
        (d.goal.predicted
          ? '；当前预测 ' + Calc.fmtDur(d.goal.predicted) +
            '；差距 ' + (d.goal.gap > 0 ? '还差 ' + Calc.fmtDur(d.goal.gap) : '已达成')
          : '；数据不足无法预测'));
    } else {
      L.push('目标：还没有设定目标');
    }
    L.push('本周课表：' + (d.plan.days.length ? d.plan.days.join('；') : '暂无') +
      (d.plan.totalKm ? '，合计 ' + d.plan.totalKm + ' km' : ''));
    if (d.predict.length) L.push('成绩预测：' + d.predict.join('；'));
    if (d.diet) {
      L.push('饮食目标：' + d.diet.target + ' kcal，蛋白质 ' + d.diet.protein +
        ' g，碳水 ' + d.diet.carbs + ' g，水 ' + d.diet.water + ' ml（' + d.diet.typeText + '导向）');
    }
    if (d.recentRuns.length) L.push('最近记录：' + d.recentRuns.join('；'));
    return L.join('\n');
  }

  function reset() {
    inboxes = { coach: [], buddy: [] };
    trace = [];
    snap = null;
  }

  return {
    on: on, off: off, emit: emit,
    send: send, read: read, peek: peek, pending: pending,
    record: record, history: history,
    data: data, text: text, invalidate: invalidate, reset: reset,
    _build: build
  };
})();

if (typeof window !== 'undefined') window.AgentBus = AgentBus;
