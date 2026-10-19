/* ============================================================
   app.js — 界面渲染与交互
   ============================================================ */

(function () {

  /* ================= 基础工具 ================= */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var toastTimer = null;
  window.toast = function (msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  };

  var WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  function cnDate(s) {
    var d = Store.parseDate(s);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[(d.getDay() + 6) % 7];
  }
  function shortDate(s) {
    var p = String(s).split('-');
    return (+p[1]) + '/' + (+p[2]);
  }
  function scoreColor(s) {
    if (s === null || s === undefined) return '#c7d2df';
    if (s >= 88) return '#0fb894';
    if (s >= 70) return '#2f7dfa';
    if (s >= 50) return '#f5a623';
    return '#ef4b5c';
  }
  function badge(text, key) {
    if (!text) return '';
    return '<span class="badge badge-' + (key || 'grey') + '">' + esc(text) + '</span>';
  }
  var RUN_TYPE = {
    easy: { label: '轻松跑', key: 'teal' },
    tempo: { label: '节奏跑', key: 'blue' },
    interval: { label: '间歇跑', key: 'violet' },
    long: { label: '长距离', key: 'orange' },
    race: { label: '比赛/测试', key: 'danger' },
    recovery: { label: '恢复跑', key: 'grey' }
  };

  /* ================= 状态 ================= */
  var cache = { bodyEval: null, volume: null, plan: null, diet: null, pred: null };

  function recompute() {
    var p = Store.getProfile();
    var runs = Store.getRuns();
    var goals = Store.getGoals();
    var checkins = Store.getCheckins();
    cache.bodyEval = Calc.evaluateBody(p, runs, checkins);
    cache.pred = Calc.racePredict(runs);
    cache.volume = Coach.recommendVolume(p, runs, goals);
    cache.plan = Coach.buildPlan(p, runs, goals, cache.volume);
    cache.diet = Coach.dietPlan(p, cache.bodyEval, runs, goals);
    cache.goals = Coach.goalAnalysis(goals, runs);
  }

  /* ================= 图表 ================= */
  function niceMax(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var n = v / mag;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return m * mag;
  }

  function barChart(items) {
    var W = 600, H = 186, padL = 34, padR = 10, padT = 16, padB = 26;
    var max = niceMax(Math.max.apply(null, items.map(function (d) { return d.value; }).concat([0])));
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = items.length, gap = 10;
    var bw = (iw - gap * (n - 1)) / n;
    var parts = [];
    [0, .5, 1].forEach(function (f) {
      var y = padT + ih * (1 - f);
      parts.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#eef3f8" stroke-width="1"/>');
      parts.push('<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#9aa8bc">' + (max * f).toFixed(max < 10 ? 1 : 0) + '</text>');
    });
    items.forEach(function (d, i) {
      var x = padL + i * (bw + gap);
      var full = ih * Math.min(1, d.value / max);
      var h = d.value > 0 ? Math.max(full, 3) : 0;
      var y = padT + ih - h;
      var fill = i === n - 1 ? '#ff6a3d' : (d.value > 0 ? '#ffcab5' : '#f1f5f9');
      parts.push('<rect x="' + x + '" y="' + (padT + ih - Math.max(h, 0)) + '" width="' + bw + '" height="' + Math.max(h, 1) + '" rx="5" fill="' + fill + '"/>');
      if (d.value > 0) parts.push('<text x="' + (x + bw / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="10.5" fill="#41506a" font-weight="600">' + d.value + '</text>');
      parts.push('<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#9aa8bc">' + esc(d.label) + '</text>');
    });
    return '<div class="chart-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' + parts.join('') + '</svg></div>';
  }

  function paceChart(series) {
    if (series.length < 2) {
      return '<div class="empty"><b>数据还不够画走势图</b>再记录几次跑步就能看到配速变化趋势</div>';
    }
    var W = 600, H = 190, padL = 46, padR = 14, padT = 18, padB = 28;
    var paces = series.map(function (s) { return s.pace; });
    var mn = Math.min.apply(null, paces), mx = Math.max.apply(null, paces);
    if (mx - mn < 25) { var c = (mx + mn) / 2; mx = c + 14; mn = c - 14; }
    var lo = mn - (mx - mn) * .16, hi = mx + (mx - mn) * .16;
    var iw = W - padL - padR, ih = H - padT - padB;
    var y = function (p) { return padT + ih * ((p - lo) / (hi - lo)); };
    var x = function (i) { return padL + (series.length === 1 ? iw / 2 : iw * i / (series.length - 1)); };
    var parts = [];
    [lo, (lo + hi) / 2, hi].forEach(function (p) {
      parts.push('<line x1="' + padL + '" y1="' + y(p) + '" x2="' + (W - padR) + '" y2="' + y(p) + '" stroke="#eef3f8"/>');
      parts.push('<text x="' + (padL - 6) + '" y="' + (y(p) + 3.5) + '" text-anchor="end" font-size="10" fill="#9aa8bc">' + Calc.fmtPace(p) + '</text>');
    });
    var pts = series.map(function (s, i) { return x(i) + ',' + y(s.pace); });
    parts.push('<polygon points="' + (padL + ',' + (padT + ih)) + ' ' + pts.join(' ') + ' ' + (x(series.length - 1) + ',' + (padT + ih)) + '" fill="rgba(255,106,61,.09)"/>');
    parts.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#ff6a3d" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>');
    series.forEach(function (s, i) {
      parts.push('<circle cx="' + x(i) + '" cy="' + y(s.pace) + '" r="3.4" fill="#fff" stroke="#ff6a3d" stroke-width="2"/>');
    });
    parts.push('<text x="' + padL + '" y="' + (H - 8) + '" font-size="10" fill="#9aa8bc">' + shortDate(series[0].date) + '</text>');
    parts.push('<text x="' + (W - padR) + '" y="' + (H - 8) + '" text-anchor="end" font-size="10" fill="#9aa8bc">' + shortDate(series[series.length - 1].date) + '</text>');
    var trend = Calc.paceTrend(series);
    parts.push('<text x="' + (padL + 8) + '" y="' + (padT + 2) + '" font-size="10.5" fill="#8e9bb0">' +
      (trend < -0.6 ? '趋势：越来越快 ↘' : trend > 0.6 ? '趋势：有所放慢 ↗' : '趋势：基本稳定 →') + '</text>');
    return '<div class="chart-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' + parts.join('') + '</svg></div>';
  }

  function scoreRing(score, pending) {
    var r = 50, c = 2 * Math.PI * r;
    var val = pending ? 0 : (score || 0);
    var off = c * (1 - val / 100);
    var col = pending ? '#c7d2df' : scoreColor(score);
    return '<div class="score-ring"><svg viewBox="0 0 118 118" width="118" height="118">' +
      '<circle cx="59" cy="59" r="' + r + '" fill="none" stroke="#eef2f7" stroke-width="10"/>' +
      '<circle cx="59" cy="59" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="10" stroke-linecap="round" ' +
      'stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '"/>' +
      '</svg><div class="score-txt"><b style="color:' + col + '">' + (pending ? '—' : val) + '</b><span>身体状态分</span></div></div>';
  }

  /* ================= 顶部 / 切换 ================= */

  function renderTopbar() {
    $('#topToday').textContent = cnDate(Store.today());
    var done = Store.isChecked(Store.today());
    var btn = $('#btnQuickCheckin');
    btn.textContent = done ? '✓ 今日已打卡' : '今日打卡';
    btn.className = 'btn btn-sm ' + (done ? 'btn-ghost' : 'btn-primary');
  }

  /* 导航归成 5 项；「我的数据」「训练计划」是合并页，里面再用二级页签分 */
  var GROUPS = {
    data: {
      label: '我的数据',
      views: [['body', '身体档案'], ['runs', '跑步记录'], ['checkin', '每日打卡']]
    },
    plan: {
      label: '训练计划',
      views: [['train', '训练推荐'], ['goals', '目标设定']]
    }
  };

  /* 视图 → 所属分组 */
  var VIEW_GROUP = {};
  Object.keys(GROUPS).forEach(function (g) {
    GROUPS[g].views.forEach(function (v) {
      VIEW_GROUP[v[0]] = { group: g, label: v[1] };
    });
  });

  function renderSubtabs(activeView) {
    var box = $('#subtabs');
    if (!box) return;
    var hit = VIEW_GROUP[activeView];
    if (!hit) { box.hidden = true; box.innerHTML = ''; return; }
    var g = GROUPS[hit.group];
    box.hidden = false;
    box.innerHTML = g.views.map(function (v) {
      return '<button class="subtab' + (v[0] === activeView ? ' active' : '') +
        '" data-tab="' + v[0] + '">' + v[1] + '</button>';
    }).join('');
  }

  function switchTab(name) {
    var view = name;
    var nav = name;

    // 点的是合并页的分组名 → 回到上次看的那一页，没有就取第一页
    if (GROUPS[name]) {
      var last = Store.getUI()['sub_' + name];
      var ok = GROUPS[name].views.some(function (v) { return v[0] === last; });
      view = ok ? last : GROUPS[name].views[0][0];
    }
    // 点的是组内某页 → 顶层高亮那个组
    if (VIEW_GROUP[name]) nav = VIEW_GROUP[name].group;

    $$('#tabs .tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === nav); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });

    renderSubtabs(view);
    if (VIEW_GROUP[view]) {
      try { Store.setUI('sub_' + VIEW_GROUP[view].group, view); } catch (e) { }
    }

    Store.setUI('lastTab', view);

    // 主对话页是助手"全屏展开"的样子，所以那一页不显示右下角助手，
    // 切到其它页才把它放出来
    if (window.Assistant && window.Assistant.onTabChange) window.Assistant.onTabChange(view);

    if (view === 'agent') window.scrollTo({ top: 0 });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* 主对话页左侧的"今日速览" */
  function renderAgentStats() {
    var box = $('#agentStats');
    if (!box) return;
    var w7 = Calc.totalKm(Store.runsSince(7));
    var streak = Store.currentStreak();
    var ev = cache.bodyEval;
    var vol = cache.volume;
    var score = (ev && Calc.isNum(ev.score)) ? ev.score : '—';
    var rec = (vol && Calc.isNum(vol.recommend)) ? vol.recommend : '—';
    box.innerHTML =
      '<div class="ag-stat"><b>' + w7 + '<small>km</small></b><span>近 7 天</span></div>' +
      '<div class="ag-stat"><b>' + streak + '<small>天</small></b><span>连续打卡</span></div>' +
      '<div class="ag-stat"><b>' + score + '<small>分</small></b><span>身体状态</span></div>' +
      '<div class="ag-stat"><b>' + rec + '<small>km</small></b><span>建议周跑量</span></div>';
  }

  /* ================= 概览 ================= */
  function renderDash() {
    var p = Store.getProfile();
    var runs = Store.getRuns();
    var goals = Store.getGoals();
    var ev = cache.bodyEval;
    var h = new Date().getHours();
    var greet = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了';
    $('#heroHello').textContent = greet + '，' + (p.name || '跑者');
    $('#heroSub').textContent = runs.length
      ? '你已经记录了 ' + runs.length + ' 次跑步，累计 ' + Calc.totalKm(runs) + ' km。' + ev.desc.split('。')[0] + '。'
      : '先填写身体信息、记录第一次跑步，我就能开始为你做评估和推荐。';

    var w7 = Calc.totalKm(Store.runsSince(7));
    var w30 = Calc.totalKm(Store.runsSince(30));
    var streak = Store.currentStreak();
    $('#heroStat').innerHTML =
      '<div class="hero-stat"><b>' + w7 + '</b><span>近 7 天跑量 km</span></div>' +
      '<div class="hero-stat"><b style="color:#0fb894">' + streak + '</b><span>连续打卡 天</span></div>';

    /* KPI */
    var mStart = Store.today().slice(0, 7);
    var monthKm = Calc.totalKm(runs.filter(function (r) { return r.date.slice(0, 7) === mStart; }));
    var kpis = [
      { label: '近 7 天跑量', val: w7, unit: 'km', foot: '共 ' + Store.runsSince(7).length + ' 次跑步', ico: '🏃', bg: '#fff1ec', col: '#e2481c' },
      { label: '本月跑量', val: monthKm, unit: 'km', foot: '本月累计', ico: '📅', bg: '#eaf2ff', col: '#1e5fd0' },
      { label: '近 30 天', val: w30, unit: 'km', foot: '平均每周 ' + Calc.round(w30 / 4.3, 1) + ' km', ico: '📈', bg: '#e6f8f3', col: '#07806a' },
      { label: '身体状态分', val: ev.score, unit: '', foot: ev.level, ico: '❤️', bg: '#f0ecff', col: '#5a3ce0' }
    ];
    $('#kpiCards').innerHTML = kpis.map(function (k) {
      return '<div class="kpi"><div class="kpi-top"><span class="kpi-label">' + k.label + '</span>' +
        '<span class="kpi-ico" style="background:' + k.bg + '">' + k.ico + '</span></div>' +
        '<div class="kpi-val" style="color:' + k.col + '">' + k.val + (k.unit ? '<small>' + k.unit + '</small>' : '') + '</div>' +
        '<div class="kpi-foot">' + esc(k.foot) + '</div></div>';
    }).join('');

    /* 身体评估卡 */
    $('#bodyEvalTime').textContent = p.updatedAt ? '更新于 ' + String(p.updatedAt).slice(0, 10) : '尚未填写身体信息';
    $('#bodyEvalBox').innerHTML =
      '<div class="score-hero">' + scoreRing(ev.score, ev.level === '待完善') +
      '<div class="score-info"><div class="lvl" style="color:' + scoreColor(ev.score) + '">' + ev.level + '</div>' +
      '<div class="desc">' + esc(ev.desc) + '</div></div></div>' +
      '<div style="margin-top:14px" class="tips">' +
      ev.advice.map(function (a) { return '<div class="tip"><span class="tip-ico">💡</span><div>' + esc(a) + '</div></div>'; }).join('') +
      '</div>';

    /* 周跑量图 */
    var ws = Calc.weeklySeries(runs, 8);
    $('#chartWeekly').innerHTML = barChart(ws.map(function (d) { return { label: d.label, value: d.km }; }));

    /* 目标 */
    var ga = cache.goals;
    if (!ga || !ga.length) {
      $('#dashGoals').innerHTML = '<div class="empty"><b>还没有设定目标</b>设一个吧，比如"5 公里跑进 25 分"，有了目标训练会更有方向<button class="btn btn-primary btn-sm" style="margin-top:12px" data-goto="goals">去设定目标</button></div>';
    } else {
      $('#dashGoals').innerHTML = ga.slice(0, 3).map(function (g) {
        var pct = g.achieved === null ? 0 : Calc.clamp(g.achieved, 0, 130);
        return '<div style="margin-bottom:14px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px">' +
          '<div style="font-size:13.5px;font-weight:600">' + esc(g.goal.label) + ' · 目标 ' + Calc.fmtDur(g.goal.targetSeconds) + '</div>' +
          (g.gap === null ? badge('暂无对比数据', 'grey') : g.gap <= 0 ? badge('已达目标 🎉', 'teal') : badge('差 ' + Calc.fmtDur(g.gap), 'amber')) +
          '</div>' +
          '<div class="prog"><i style="width:' + Math.min(100, pct) + '%"></i></div>' +
          '<div style="display:flex;justify-content:space-between;margin-top:5px;font-size:11.5px;color:#7c8ba3">' +
          '<span>当前预测 ' + (g.predicted ? Calc.fmtDur(g.predicted) : '--') + '</span>' +
          '<span>达成度 ' + (g.achieved === null ? '--' : g.achieved + '%') + '</span></div></div>';
      }).join('');
    }

    /* 最近跑步 */
    var recent = runs.slice(0, 5);
    if (!recent.length) {
      $('#dashRecentRuns').innerHTML = '<div class="empty"><b>还没有跑步记录</b>记录第一次跑步后，这里会显示你的训练轨迹</div>';
    } else {
      $('#dashRecentRuns').innerHTML = recent.map(function (r) {
        var t = RUN_TYPE[r.type] || RUN_TYPE.easy;
        return '<div class="list-row"><div class="lr-date">' + shortDate(r.date) + '</div>' +
          '<div class="lr-main"><div class="lr-title">' + r.distance + ' km · ' + Calc.fmtDur(r.seconds) + '</div>' +
          '<div class="lr-sub">' + Calc.fmtPaceUnit(r.seconds / r.distance) + (r.note ? ' · ' + esc(r.note) : '') + '</div></div>' +
          '<div class="lr-right">' + badge(t.label, t.key) + '</div></div>';
      }).join('');
    }
  }

  /* ================= 身体档案 ================= */
  function fillProfileForm() {
    var p = Store.getProfile();
    var f = $('#formProfile');
    ['name', 'gender', 'age', 'height', 'weight', 'bodyFat', 'restHR', 'activity', 'sleep', 'level', 'injury'].forEach(function (k) {
      var inp = f.elements[k];
      if (!inp) return;
      inp.value = (p[k] === null || p[k] === undefined) ? '' : p[k];
    });
  }

  function renderBody() {
    var p = Store.getProfile();
    var ev = cache.bodyEval;

    /* 上传图片 */
    var reps = Store.getReports();
    $('#reportList').innerHTML = reps.length ? reps.map(function (r) {
      return '<div class="report-item"><img src="' + r.dataUrl + '" alt="' + esc(r.name) + '">' +
        '<button class="report-del" data-del-report="' + r.id + '">×</button>' +
        '<div class="report-meta">' + esc(String(r.addedAt).slice(0, 10)) + '</div></div>';
    }).join('') : '';

    /* 历史 */
    var hist = Store.getBodyRecords();
    if (!hist.length) {
      $('#bodyHistory').innerHTML = '<div class="empty"><b>还没有历史记录</b>建议每周固定称重 1-2 次（晨起空腹），记录趋势比单次数值更有意义</div>';
    } else {
      $('#bodyHistory').innerHTML = '<table class="tbl"><thead><tr>' +
        '<th>日期</th><th>体重 kg</th><th>体脂 %</th><th>静息心率</th><th>备注</th><th></th></tr></thead><tbody>' +
        hist.map(function (r) {
          return '<tr><td>' + esc(r.date) + '</td><td class="num">' + (r.weight || '--') + '</td>' +
            '<td class="num">' + (r.bodyFat || '--') + '</td><td class="num">' + (r.restHR || '--') + '</td>' +
            '<td>' + esc(r.note || '') + '</td>' +
            '<td style="text-align:right"><button class="tbl-del" data-del-body="' + r.id + '">🗑</button></td></tr>';
        }).join('') + '</tbody></table>';
    }

    /* 评估详情 */
    var m = ev.metrics || {};
    var extra = [];
    if (m.bmi) {
      var ir = Calc.idealWeightRange(p.height);
      extra.push('理想体重区间：' + (ir ? ir.lo + ' - ' + ir.hi + ' kg' : '--'));
      extra.push('BMI：' + m.bmi + '（' + Calc.bmiLevel(m.bmi).text + '）');
    }
    if (m.bodyFat) extra.push('体脂率：' + m.bodyFat + '%（' + Calc.bodyFatLevel(p.gender, p.age, m.bodyFat).text + '）' + (m.bodyFatEstimated ? '（估算值）' : ''));
    var bmrV = Calc.bmr(p), tdeeV = Calc.tdee(p);
    if (bmrV) extra.push('基础代谢：' + bmrV + ' kcal / 日　维持热量约：' + tdeeV + ' kcal / 日');
    var mhr = Calc.maxHR(p.age);
    if (mhr) extra.push('最大心率估算：' + mhr + ' 次/分（Tanaka 公式）');
    if (Calc.isNum(p.sleep)) extra.push('睡眠：' + p.sleep + ' 小时/日' + (p.sleep < 7 ? '（建议补到 7 小时以上）' : '（良好）'));
    if (p.injury) extra.push('伤病备注：' + p.injury);

    $('#bodyEvalDetail').innerHTML =
      '<div class="score-hero" style="margin-bottom:16px">' + scoreRing(ev.score, ev.level === '待完善') +
      '<div class="score-info"><div class="lvl" style="color:' + scoreColor(ev.score) + '">' + ev.level + '</div>' +
      '<div class="desc">' + esc(ev.desc) + '</div></div></div>' +
      ev.items.map(function (it) {
        var s = it.score;
        return '<div class="eval-item"><div class="ei-name">' + it.name + '</div>' +
          '<div class="ei-bar"><div class="prog"><i style="width:' + (s === null ? 0 : s) + '%;background:' + scoreColor(s) + '"></i></div></div>' +
          '<div class="ei-val">' + esc(it.value) + '</div>' +
          '<div class="ei-tag">' + (it.tag ? badge(it.tag, it.tag === '优秀' ? 'teal' : it.tag === '良好' ? 'blue' : it.tag === '一般' ? 'amber' : 'danger') : '') + '</div></div>' +
          '<div class="eval-note">' + esc(it.note) + '</div>';
      }).join('') +
      (extra.length ? '<div style="margin-top:16px;padding-top:14px;border-top:1px dashed #e3eaf2" class="tips">' +
        extra.map(function (e) { return '<div class="tip"><span class="tip-ico">📌</span><div>' + esc(e) + '</div></div>'; }).join('') + '</div>' : '');
  }

  /* ================= 跑步记录 ================= */
  function renderRuns() {
    var runs = Store.getRuns();

    /* KPI */
    var kpis = [
      { label: '近 7 天跑量', val: Calc.totalKm(Store.runsSince(7)), unit: 'km', ico: '🏃', bg: '#fff1ec', col: '#e2481c' },
      { label: '近 30 天跑量', val: Calc.totalKm(Store.runsSince(30)), unit: 'km', ico: '📅', bg: '#eaf2ff', col: '#1e5fd0' },
      { label: '累计跑量', val: Calc.totalKm(runs), unit: 'km', ico: '🏆', bg: '#e6f8f3', col: '#07806a' }
    ];
    $('#runKpis').innerHTML = kpis.map(function (k) {
      return '<div class="kpi"><div class="kpi-top"><span class="kpi-label">' + k.label + '</span>' +
        '<span class="kpi-ico" style="background:' + k.bg + '">' + k.ico + '</span></div>' +
        '<div class="kpi-val" style="color:' + k.col + '">' + k.val + '<small>' + k.unit + '</small></div></div>';
    }).join('');

    /* 列表 */
    var filter = $('#runFilter').value || 'all';
    var list = filter === 'all' ? runs : Store.runsSince(parseInt(filter, 10));
    if (!list.length) {
      $('#runList').innerHTML = '<div class="empty"><b>还没有记录</b>在上面的表单里填一次跑步数据，就会出现在这里</div>';
    } else {
      var avg = Calc.avgPaceOf(list);
      $('#runList').innerHTML = '<table class="tbl"><thead><tr>' +
        '<th>日期</th><th>类型</th><th>距离</th><th>用时</th><th>配速</th><th>心率</th><th>体感</th><th>备注</th><th></th>' +
        '</tr></thead><tbody>' +
        list.map(function (r) {
          var t = RUN_TYPE[r.type] || RUN_TYPE.easy;
          return '<tr><td>' + esc(r.date) + '</td>' +
            '<td>' + badge(t.label, t.key) + '</td>' +
            '<td class="num">' + r.distance + ' km</td>' +
            '<td class="num">' + Calc.fmtDur(r.seconds) + '</td>' +
            '<td class="num">' + Calc.fmtPaceUnit(r.seconds / r.distance) + '</td>' +
            '<td class="num">' + (r.hr || '--') + '</td>' +
            '<td class="num">' + (r.rpe || '--') + '</td>' +
            '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.note || '') + '</td>' +
            '<td style="text-align:right"><button class="tbl-del" data-del-run="' + r.id + '">🗑</button></td></tr>';
        }).join('') + '</tbody></table>' +
        (avg ? '<div style="margin-top:12px;font-size:12.5px;color:#7c8ba3">该范围内平均配速 <b style="color:#e2481c">' + Calc.fmtPaceUnit(avg) + '</b>，共 ' + list.length + ' 次跑步</div>' : '');
    }

    /* 配速图 */
    $('#chartPace').innerHTML = paceChart(Calc.paceSeries(runs, 30));
  }

  /* ================= 目标 ================= */
  function renderGoals() {
    var ga = cache.goals;
    if (!ga || !ga.length) {
      $('#goalList').innerHTML = '<div class="empty"><b>还没有设定目标</b>目标可以只设一个，比如"5 公里跑进 25 分钟"或"半马跑进 2 小时"。不设目标也可以，我会按你的身体数据给通用建议。</div>';
      return;
    }
    $('#goalList').innerHTML = ga.map(function (g) {
      var g0 = g.goal;
      var pct = g.achieved === null ? 0 : Calc.clamp(g.achieved, 0, 130);
      var statusBadge = g.gap === null ? badge('暂无对比数据', 'grey')
        : g.gap <= 0 ? badge('已达目标 🎉', 'teal')
          : badge('还差 ' + Calc.fmtDur(g.gap), 'amber');
      var paceTxt = Calc.fmtPaceUnit(g0.targetSeconds / g0.distanceKm);
      var fromTxt = g.predictedFrom && g.predictedFrom.date
        ? ('依据 ' + g.predictedFrom.date + ' 的 ' + g.predictedFrom.distance + ' km ' +
          ((RUN_TYPE[g.predictedFrom.type] || RUN_TYPE.easy).label) + '记录推算')
        : '';
      return '<div class="card" style="box-shadow:none;border:1px solid #e3eaf2;margin-bottom:14px;background:#fbfdff">' +
        '<div class="card-head" style="margin-bottom:10px">' +
        '<div><div style="font-size:15px;font-weight:700">' + esc(g0.label) + '</div>' +
        '<div style="font-size:12px;color:#7c8ba3;margin-top:3px">目标成绩 <b style="color:#e2481c">' + Calc.fmtDur(g0.targetSeconds) + '</b>（配速 ' + paceTxt + '）' +
        (g0.targetDate ? '　目标日期 ' + esc(g0.targetDate) : '') + '</div></div>' +
        '<div style="display:flex;gap:8px;align-items:center">' + statusBadge +
        '<button class="btn btn-danger-ghost btn-sm" data-del-goal="' + g0.id + '">删除</button></div></div>' +
        '<div class="prog"><i style="width:' + Math.min(100, pct) + '%"></i></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12.5px;color:#41506a">' +
        '<span>当前水平预测：<b>' + (g.predicted ? Calc.fmtDur(g.predicted) : '数据不足') + '</b></span>' +
        '<span>目标达成度 <b>' + (g.achieved === null ? '--' : g.achieved + '%') + '</b></span></div>' +
        (fromTxt ? '<div style="font-size:11.5px;color:#9aa8bc;margin-top:6px">' + esc(fromTxt) + '</div>' : '') +
        '<div style="font-size:12px;color:#7c8ba3;margin-top:8px">' +
        (g.gap === null ? '多记录几次跑步后，这里会给出更准确的对比。'
          : g.gap <= 0 ? '你已经达到这个目标了，可以考虑设一个更有挑战的新目标。'
            : '按当前水平需要再快 ' + Calc.fmtDur(g.gap) + '，约相当于每公里快 ' + Math.round(g.gap / g0.distanceKm) + ' 秒。建议把这个周期拉到 8-12 周。') +
        '</div></div>';
    }).join('');
  }

  /* ================= 训练推荐 ================= */
  function renderTrain() {
    var v = cache.volume, pl = cache.plan, runs = Store.getRuns(), p = Store.getProfile();
    var split = Coach.intensitySplit(runs);
    var ri = Calc.runningIndex(cache.pred);
    var mhr = Calc.maxHR(p.age);
    var zones = Calc.hrZones(mhr);

    var html = '';

    html += '<div class="grid grid-4">' +
      kpiCard('建议周跑量', v.recommend, 'km', '当前周均 ' + v.current + ' km', '🎯', '#fff1ec', '#e2481c') +
      kpiCard('下周一目标', v.nextWeek, 'km', '增幅约 8%（安全区间）', '📈', '#eaf2ff', '#1e5fd0') +
      kpiCard('建议安全上限', v.ceiling, 'km', '超过需要更系统周期训练', '🛡️', '#e6f8f3', '#07806a') +
      kpiCard('跑力指数', ri === null ? '--' : ri, '', ri === null ? '记录一次跑步后可见' : (ri >= 80 ? '接近精英跑者' : ri >= 60 ? '进阶跑者水平' : ri >= 40 ? '业余爱好者水平' : '起步阶段'), '⚡', '#f0ecff', '#5a3ce0') +
      '</div>';

    /* 跑量推荐说明 */
    html += '<div class="card"><div class="card-head"><h3>周跑量推荐依据</h3>' +
      '<span class="card-hint">安全区间 ' + v.range[0] + ' - ' + v.range[1] + ' km/周</span></div>' +
      '<div class="tips">' +
      v.reasons.map(function (r) { return tip('📊', r); }).join('') +
      (v.goalNote ? tip('🎯', v.goalNote) : '') +
      '</div>' +
      '<div style="margin-top:16px;display:flex;align-items:center;gap:12px">' +
      '<span style="font-size:12px;color:#7c8ba3;white-space:nowrap">当前 ' + v.current + ' km</span>' +
      '<div class="prog" style="flex:1"><i style="width:' + Math.min(100, v.ceiling ? v.current / v.ceiling * 100 : 0) + '%"></i></div>' +
      '<span style="font-size:12px;color:#7c8ba3;white-space:nowrap">上限 ' + v.ceiling + ' km</span></div>' +
      '</div>';

    /* 课表 */
    html += '<div class="card"><div class="card-head"><h3>本周训练课表</h3>' +
      '<span class="card-hint">周总量 ' + pl.totalKm + ' km · 质量课 ' + pl.qualityCount + ' 次</span></div>' +
      (pl.downgraded ? '<div style="margin-bottom:14px">' + tip('🧱', pl.downgradeNote) + '</div>' : '') +
      '<div class="week-grid">' +
      pl.plan.map(function (d) {
        var paceTxt = d.pace ? Calc.fmtPaceUnit(d.pace.sec) : '';
        return '<div class="day-cell' + (d.rest ? ' rest' : '') + '">' +
          '<div class="dc-day">' + d.day + (d.rest ? '' : badge(String(d.km), 'orange')) + '</div>' +
          '<div class="dc-type">' + esc(d.type) + '</div>' +
          (d.km > 0 ? '<div class="dc-km">' + d.km + '<small> km</small></div>' : '<div class="dc-km" style="color:#b9c4d3">休息</div>') +
          (paceTxt ? '<div style="font-size:11.5px;color:#e2481c;font-weight:600">目标配速 ' + paceTxt + '</div>' : '') +
          '<div class="dc-desc">' + esc(d.desc) + '</div></div>';
      }).join('') +
      '</div>' +
      (pl.anchor ? '<div style="margin-top:12px;font-size:12px;color:#7c8ba3">配速锚点：' + esc(pl.anchor.from) + '，基准配速 ' + Calc.fmtPaceUnit(pl.anchor.pace) + '</div>' : '<div style="margin-top:12px;font-size:12px;color:#7c8ba3">暂时没有足够的跑步数据来推算训练配速，先按"能轻松说话"的强度跑，记录几次后我会给出具体配速。</div>') +
      '</div>';

    /* 配速区间 + 心率区间 */
    html += '<div class="grid grid-2">';
    html += '<div class="card"><div class="card-head"><h3>训练配速区间</h3></div>';
    if (pl.paces) {
      html += '<table class="pace-table"><thead><tr><th>课型</th><th>配速</th><th>用法</th></tr></thead><tbody>' +
        pl.paces.map(function (x) {
          return '<tr><td><b>' + esc(x.name) + '</b></td><td><b style="color:#e2481c">' + Calc.fmtPaceUnit(x.sec) + '</b></td><td style="color:#7c8ba3">' + esc(x.use) + '</td></tr>';
        }).join('') + '</tbody></table>';
    } else {
      html += '<div class="empty"><b>需要一点数据</b>记录 1-2 次跑步，或设定一个目标，就能算出你的五档训练配速</div>';
    }
    html += '</div>';

    html += '<div class="card"><div class="card-head"><h3>心率训练区间</h3>' +
      '<span class="card-hint">' + (mhr ? '最大心率约 ' + mhr + ' 次/分' : '填写年龄后可计算') + '</span></div>';
    if (zones.length) {
      html += '<table class="pace-table"><thead><tr><th>区间</th><th>心率</th><th>训练用途</th></tr></thead><tbody>' +
        zones.map(function (z) {
          return '<tr><td><span class="zone-dot" style="background:' + z.color + '"></span><b>' + esc(z.name) + '</b></td>' +
            '<td><b>' + z.text + '</b></td><td style="color:#7c8ba3">' + esc(z.use) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<div style="margin-top:12px;font-size:12px;color:#7c8ba3">大部分跑量放在 Z1-Z2 区间（能正常说话），效果最好也最不容易受伤。</div>';
    } else {
      html += '<div class="empty"><b>需要年龄</b>填写年龄后自动按 Tanaka 公式计算最大心率与五个训练区间</div>';
    }
    html += '</div></div>';

    /* 强度分布 */
    html += '<div class="card"><div class="card-head"><h3>训练强度分布</h3>' +
      '<span class="card-hint">' + (split.hasData ? '近 8 周共 ' + split.total + ' km' : '暂无数据') + '</span></div>' +
      '<div style="display:flex;height:22px;border-radius:8px;overflow:hidden;background:#eef2f7">' +
      '<div style="width:' + split.easy + '%;background:linear-gradient(90deg,#5fdcc2,#0fb894);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">' + split.easy + '%</div>' +
      '<div style="width:' + split.hard + '%;background:linear-gradient(90deg,#ffa478,#ff6a3d);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">' + split.hard + '%</div>' +
      '</div>' +
      '<div class="chart-legend"><span><i style="background:#0fb894"></i>轻松跑 / 长距离（低强度）</span><span><i style="background:#ff6a3d"></i>节奏 / 间歇 / 比赛（高强度）</span></div>' +
      '<div class="tips" style="margin-top:14px">' +
      tip(split.easy >= 70 ? '✅' : '⚠️', split.hasData
        ? (split.easy >= 75 ? '强度分布很健康，低强度占 ' + split.easy + '%，正是经典的 80/20 原则。'
          : split.easy >= 60 ? '低强度占比 ' + split.easy + '%，略低于理想值，建议把更多跑量放到轻松跑上。'
            : '高强度占比偏高（' + split.hard + '%），长期这样容易受伤和过度疲劳，需要把轻松跑比例提到 75% 以上。')
        : '记录几次跑步后，这里会分析你的训练强度分布是否合理。') +
      tip('📌', '经典原则：约 80% 的跑量用低强度（能聊天的速度）完成，20% 用于高质量训练。这是被验证过最不容易受伤、也最能持续进步的比例。') +
      '</div></div>';

    /* 阶段建议 */
    html += '<div class="card"><div class="card-head"><h3>训练方法建议</h3></div><div class="tips">' +
      methodTips(v, p, runs).map(function (t) { return tip(t.ico, t.text); }).join('') +
      '</div></div>';

    $('#trainBox').innerHTML = html;
  }

  function kpiCard(label, val, unit, foot, ico, bg, col) {
    return '<div class="kpi"><div class="kpi-top"><span class="kpi-label">' + label + '</span>' +
      '<span class="kpi-ico" style="background:' + bg + '">' + ico + '</span></div>' +
      '<div class="kpi-val" style="color:' + col + '">' + val + (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      '<div class="kpi-foot">' + esc(foot) + '</div></div>';
  }
  function tip(ico, text) {
    return '<div class="tip"><span class="tip-ico">' + ico + '</span><div>' + esc(text) + '</div></div>';
  }

  function methodTips(v, p, runs) {
    var out = [];
    var level = p.level || 'intermediate';
    if (v.started) {
      out.push({ ico: '🚶', text: '第 1-3 周：采用"跑走结合"，例如跑 3 分钟走 1 分钟，重复 8 次。目标不是速度，是让身体适应持续运动。' });
      out.push({ ico: '⏱️', text: '每周固定 3 天（比如周二、周四、周六），时间固定下来比跑多少更重要。' });
    }
    out.push({ ico: '🏃', text: '轻松跑（E）：占总跑量 70-80%。标准很简单——能连续说完整句子，跑完不觉得累。' });
    if (level !== 'beginner') {
      out.push({ ico: '🔥', text: '阈値跑（T）：每周 1 次。热身 1.5 km 后，用"舒适的痛苦"强度持续跑 20-30 分钟。提升成绩最快的课。' });
      out.push({ ico: '⚡', text: '间歇跑（I）：每周最多 1 次。例如 6-8 组 × 800 m，组间慢跑 2 分钟。注意：量要少、质要高。' });
      out.push({ ico: '🛣️', text: '长距离（L）：每周 1 次，占周跑量 25-35%。配速用轻松跑，时间比距离更重要（新手先跑到 90 分钟）。' });
    }
    if (p.injury && p.injury !== '无' && p.injury.indexOf('无') < 0) {
      out.push({ ico: '🩹', text: '你有伤病史：所有跑量增幅减半，跑前热身和跑后拉伸各延长到 10 分钟，疼痛出现立即停止。' });
    }
    out.push({ ico: '📅', text: '每 3-4 周安排 1 个"降量周"，跑量减到 70% 左右，让身体真正吸收训练成果。' });
    out.push({ ico: '💪', text: '每周 2 次力量训练（深蹲、保加利亚分腿蹲、平板支撑、提踵），能显著减少跑步伤病。' });
    if (Calc.isNum(p.sleep) && p.sleep < 7) out.push({ ico: '😴', text: '你目前睡眠偏少，这是提升的最大瓶颈。睡不够的训练基本等于白练。' });
    return out;
  }

  /* ================= 饮食推荐 ================= */
  function renderDiet() {
    var d = cache.diet;
    if (!d.ok) {
      $('#dietBox').innerHTML = '<div class="card"><div class="empty"><b>还差一点身体数据</b>' + esc(d.reason) +
        '<div style="margin-top:14px"><button class="btn btn-primary btn-sm" data-goto="body">去填写身体信息</button></div></div></div>';
      return;
    }
    var html = '';
    html += '<div class="grid grid-4">' +
      kpiCard('每日目标热量', d.target, 'kcal', d.typeText + '导向', '🔥', '#fff1ec', '#e2481c') +
      kpiCard('蛋白质', d.protein, 'g', d.proteinPerKg + ' g/kg 体重', '🥩', '#eaf2ff', '#1e5fd0') +
      kpiCard('碳水', d.carbs, 'g', '训练日 ' + d.carbsTrainDay + ' g', '🍚', '#e6f8f3', '#07806a') +
      kpiCard('脂肪', d.fat, 'g', '优质脂肪优先', '🥑', '#f0ecff', '#5a3ce0') +
      '</div>';

    /* 热量构成 */
    html += '<div class="grid grid-2">';
    html += '<div class="card"><div class="card-head"><h3>热量怎么算出来的</h3></div>' +
      '<table class="pace-table"><tbody>' +
      '<tr><td>基础代谢 (BMR)</td><td style="text-align:right"><b>' + d.bmr + ' kcal</b></td></tr>' +
      '<tr><td>日常 + 活动消耗 (TDEE)</td><td style="text-align:right"><b>' + d.tdee + ' kcal</b></td></tr>' +
      '<tr><td>跑步额外消耗（近 7 天 ' + d.kmWeek + ' km）</td><td style="text-align:right"><b>+' + d.trainKcalDay + ' kcal/日</b></td></tr>' +
      '<tr><td>目标调整（' + d.typeText + '）</td><td style="text-align:right"><b style="color:' + (d.target - d.tdee - d.trainKcalDay < 0 ? '#0fb894' : '#e2481c') + '">' +
      (d.target - d.tdee - d.trainKcalDay >= 0 ? '+' : '') + (d.target - d.tdee - d.trainKcalDay) + ' kcal</b></td></tr>' +
      '<tr><td><b>每日目标摄入</b></td><td style="text-align:right"><b style="color:#e2481c;font-size:15px">' + d.target + ' kcal</b></td></tr>' +
      '</tbody></table>' +
      (d.floored ? '<div style="margin-top:10px">' + tip('⚠️', '计算结果低于安全下限，已自动上调。减脂不要低于基础代谢，否则会掉肌肉、影响运动表现。') + '</div>' : '') +
      '</div>';

    /* 三大营养素 */
    html += '<div class="card"><div class="card-head"><h3>三大营养素配比</h3>' +
      '<span class="card-hint">训练日碳水可上调、休息日下调</span></div>' +
      '<div class="macro">' +
      macroItem('蛋白质', d.protein + ' g', d.pPct, '#2f7dfa') +
      macroItem('碳水', d.carbs + ' g', d.cPct, '#0fb894') +
      macroItem('脂肪', d.fat + ' g', d.fPct, '#f5a623') +
      '</div>' +
      '<div style="margin-top:16px">' + tip('🔄', '训练日建议碳水 ' + d.carbsTrainDay + ' g、休息日 ' + d.carbsRestDay + ' g；蛋白质和脂肪每天保持稳定即可。') + '</div>' +
      '</div></div>';

    /* 食谱 */
    html += '<div class="card"><div class="card-head"><h3>每日饮食建议</h3>' +
      '<span class="card-hint">按你的体重与目标匹配的份量</span></div>' +
      '<div class="meal-grid">' +
      d.meals.map(function (m) {
        return '<div class="meal"><h5>' + m.ico + ' ' + esc(m.name) + '<span style="margin-left:auto;font-size:11.5px;color:#7c8ba3">约 ' + m.kcal + ' kcal</span></h5>' +
          '<ul>' + m.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
      }).join('') + '</div></div>';

    /* 补水 + 提示 */
    html += '<div class="grid grid-2">';
    html += '<div class="card"><div class="card-head"><h3>补水建议</h3></div><div class="tips">' +
      tip('💧', '日常每天约 ' + d.water + ' ml（约 ' + Math.round(d.water / 250) + ' 杯水），跑步日在此基础上增加。') +
      tip('🏃', d.runWater) +
      tip('🧂', '长距离或大量出汗后，除了水还要补钠（淡盐水或运动饮料），只喝白水可能越喝越乏力。') +
      '</div></div>';
    html += '<div class="card"><div class="card-head"><h3>关键提醒</h3></div><div class="tips">' +
      d.notes.map(function (n) { return tip('📌', n); }).join('') +
      '</div></div></div>';

    /* 比赛补给 */
    html += '<div class="card"><div class="card-head"><h3>比赛日 / 长距离补给</h3>' +
      '<span class="card-hint">距离超过 90 分钟才需要考虑这些</span></div><div class="tips">' +
      d.raceTips.map(function (t) { return tip('🏅', t); }).join('') +
      '</div></div>';

    $('#dietBox').innerHTML = html;
  }

  function macroItem(label, val, pct, color) {
    return '<div class="macro-item"><div class="mi-label">' + label + '</div>' +
      '<div class="mi-val" style="color:' + color + '">' + val + ' <span style="font-size:11.5px;color:#7c8ba3;font-weight:600">' + pct + '%</span></div>' +
      '<div class="macro-bar"><i style="width:' + pct + '%;background:' + color + '"></i></div></div>';
  }

  /* ================= 打卡 ================= */
  var calCursor = null;

  function renderCheckin() {
    var checkins = Store.getCheckins();
    var runs = Store.getRuns();
    var today = Store.today();
    var month = today.slice(0, 7);

    var mChecks = Object.keys(checkins).filter(function (d) { return d.slice(0, 7) === month; }).length;
    var mRuns = {}; runs.forEach(function (r) { mRuns[r.date] = 1; });
    var mRunDays = Object.keys(mRuns).filter(function (d) { return d.slice(0, 7) === month; }).length;

    $('#checkinKpis').innerHTML =
      kpiCard('累计打卡', Store.checkedCount(), '天', '从第 1 天开始算', '✅', '#e6f8f3', '#07806a') +
      kpiCard('当前连续', Store.currentStreak(), '天', '今天打卡就会继续', '🔥', '#fff1ec', '#e2481c') +
      kpiCard('最长连续', Store.maxStreak(), '天', '历史最好记录', '🏅', '#eaf2ff', '#1e5fd0');

    /* 日历 */
    if (!calCursor) calCursor = { y: new Date().getFullYear(), m: new Date().getMonth() };
    var y = calCursor.y, mo = calCursor.m;
    $('#calTitle').textContent = y + ' 年 ' + (mo + 1) + ' 月';
    var first = new Date(y, mo, 1);
    var startPad = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var cells = [];
    for (var i = 0; i < startPad; i++) cells.push('<div class="cal-day blank"></div>');
    for (var d = 1; d <= daysInMonth; d++) {
      var ds = y + '-' + (mo + 1 < 10 ? '0' : '') + (mo + 1) + '-' + (d < 10 ? '0' : '') + d;
      var cls = ['cal-day'];
      if (checkins[ds]) cls.push('checked');
      if (mRuns[ds]) cls.push('hasrun');
      if (ds === today) cls.push('today');
      if (ds > today) cls.push('future');
      var km = 0; runs.forEach(function (r) { if (r.date === ds) km += r.distance; });
      cells.push('<div class="' + cls.join(' ') + '" data-cal-date="' + ds + '">' +
        '<div class="cd-num">' + d + '</div>' +
        (km > 0 ? '<div class="cd-km">' + Calc.round(km, 1) + ' km</div>' : '') +
        '</div>');
    }
    while (cells.length % 7 !== 0) cells.push('<div class="cal-day blank"></div>');
    $('#calGrid').innerHTML = cells.join('');

    /* 统计 */
    var total30 = 0;
    for (var i2 = 0; i2 < 30; i2++) {
      var dd = Store.addDays(today, -i2);
      if (checkins[dd]) total30++;
    }
    var rate = Math.round(total30 / 30 * 100);
    $('#checkinStats').innerHTML = '<table class="pace-table"><tbody>' +
      '<tr><td>累计打卡天数</td><td style="text-align:right"><b>' + Store.checkedCount() + ' 天</b></td></tr>' +
      '<tr><td>近 30 天打卡</td><td style="text-align:right"><b>' + total30 + ' 天（' + rate + '%）</b></td></tr>' +
      '<tr><td>近 30 天跑步天数</td><td style="text-align:right"><b>' + Object.keys(mRuns).filter(function (k) { return Store.daysBetween(k, today) <= 29; }).length + ' 天</b></td></tr>' +
      '<tr><td>本月打卡</td><td style="text-align:right"><b>' + mChecks + ' 天</b></td></tr>' +
      '<tr><td>本月跑步天数</td><td style="text-align:right"><b>' + mRunDays + ' 天</b></td></tr>' +
      '</tbody></table>';

    var words = Coach.encouragements();
    var pick = words[(new Date().getDate()) % words.length];
    var extra = Store.currentStreak() >= 3 ? '<br><br>你已经连续打卡 <b>' + Store.currentStreak() + ' 天</b> 了，这种稳定性比任何一次拼尽全力的训练都值钱。' : '';
    $('#checkinWords').innerHTML = pick + extra + '<br><br><span style="font-size:12px;color:#9aa8bc">点击日历上的日期即可打卡 / 取消打卡，也可以点右上角的"今日打卡"按钮。</span>';
  }

  /* ================= 全量渲染 ================= */
  function renderAll() {
    recompute();
    renderDemoBanner();
    renderTopbar();
    renderDash();
    renderBody();
    renderRuns();
    renderGoals();
    renderTrain();
    renderDiet();
    renderCheckin();
    renderAgentStats();
  }

  /* ================= 事件 ================= */
  function bindEvents() {

    /* tab */
    $('#tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (b) switchTab(b.dataset.tab);
    });
    /* 二级页签 */
    var subBox = $('#subtabs');
    if (subBox) {
      subBox.addEventListener('click', function (e) {
        var b = e.target.closest('.subtab');
        if (b) switchTab(b.dataset.tab);
      });
    }
    document.addEventListener('click', function (e) {
      var g = e.target.closest('[data-goto]');
      if (g) {
        switchTab(g.dataset.goto);
        var act = g.dataset.action;
        if (act === 'new-run') setTimeout(function () { $('#formRun').elements.distance.focus(); }, 260);
        if (act === 'new-body') setTimeout(function () { $('#uploader').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 260);
      }
    });

    /* 快速打卡 */
    $('#btnQuickCheckin').addEventListener('click', function () {
      var today = Store.today();
      if (Store.isChecked(today)) {
        toast('今天已经打过卡啦 ✅');
        return;
      }
      Store.checkin(today, { withRun: Store.runsOn(today).length > 0 });
      toast('打卡成功！连续 ' + Store.currentStreak() + ' 天 🔥');
      renderAll();
      if (window.Assistant) window.Assistant.onCheckin(Store.currentStreak());
    });

    /* 身体信息表单 */
    $('#formProfile').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, o = {};
      ['name'].forEach(function (k) { o[k] = f.elements[k].value.trim(); });
      o.gender = f.elements.gender.value;
      o.level = f.elements.level.value;
      o.injury = f.elements.injury.value.trim();
      o.activity = parseFloat(f.elements.activity.value);
      ['age', 'height', 'weight', 'bodyFat', 'restHR', 'sleep'].forEach(function (k) {
        var v = f.elements[k].value;
        o[k] = v === '' ? null : parseFloat(v);
      });
      if (o.height !== null && (o.height < 100 || o.height > 230)) { msg('#profileMsg', '身高数值看起来不太对，请检查', true); return; }
      if (o.weight !== null && (o.weight < 25 || o.weight > 200)) { msg('#profileMsg', '体重数值看起来不太对，请检查', true); return; }
      Store.saveProfile(o);
      msg('#profileMsg', '已保存 ✓ 评估与推荐已更新');
      renderAll();
      if (window.Assistant) window.Assistant.onProfileSaved();
    });

    /* 上传报告图片 */
    var up = $('#uploader'), file = $('#fileReport');
    up.addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      var f0 = file.files[0];
      if (!f0) return;
      if (!/^image\//.test(f0.type)) { toast('请选择图片文件'); return; }
      compressImage(f0, 1000, 0.72, function (dataUrl) {
        try {
          Store.addReport({ name: f0.name, dataUrl: dataUrl });
          toast('图片已保存到本地');
          renderBody();
        } catch (err) {
          toast('保存失败：本地存储空间不足，请先删除部分旧图片');
        }
      });
      file.value = '';
    });

    /* 新增身体记录 */
    $('#btnAddBodyRec').addEventListener('click', function () {
      var today = Store.today();
      var w = prompt('今天的体重 (kg)？（可留空）', '');
      if (w === null) return;
      var bf = prompt('体脂率 (%)？（可留空）', '');
      if (bf === null) return;
      var hr = prompt('静息心率 (次/分)？（可留空）', '');
      if (hr === null) return;
      var note = prompt('备注？（可留空）', '') || '';
      if (!w && !bf && !hr) { toast('至少要填一项数据'); return; }
      Store.addBodyRecord({
        date: today,
        weight: w ? parseFloat(w) : null,
        bodyFat: bf ? parseFloat(bf) : null,
        restHR: hr ? parseInt(hr, 10) : null,
        note: note
      });
      toast('身体数据已记录');
      renderAll();
      if (window.Assistant) window.Assistant.onBodyLogged();
    });

    /* 跑步表单 */
    var fr = $('#formRun');
    fr.elements.date.value = Store.today();
    fr.addEventListener('input', function () {
      var d = parseFloat(fr.elements.distance.value);
      var s = durSeconds(fr);
      if (d > 0 && s > 0) {
        $('#livePace').textContent = '当前配速 ' + Calc.fmtPaceUnit(s / d) + '　预计 ' + Calc.fmtDur(s);
      } else {
        $('#livePace').textContent = '';
      }
    });
    $('#rpeRange').addEventListener('input', function () { $('#rpeVal').textContent = this.value; });

    fr.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = parseFloat(fr.elements.distance.value);
      var s = durSeconds(fr);
      if (!(d > 0)) { msg('#runMsg', '请填写有效的距离', true); return; }
      if (!(s > 0)) { msg('#runMsg', '请填写有效的用时', true); return; }
      if (d / (s / 3600) > 40) { msg('#runMsg', '这个配速有点夸张（超过 40 km/h），请检查数据', true); return; }
      var run = {
        date: fr.elements.date.value || Store.today(),
        type: fr.elements.type.value,
        distance: Calc.round(d, 2),
        seconds: Math.round(s),
        hr: fr.elements.hr.value ? parseInt(fr.elements.hr.value, 10) : null,
        rpe: parseInt(fr.elements.rpe.value, 10),
        note: fr.elements.note.value.trim()
      };
      Store.addRun(run);
      // 跑步当天自动打卡
      Store.checkin(run.date, { withRun: true });
      msg('#runMsg', '已保存 ✓ ' + run.distance + ' km / ' + Calc.fmtDur(run.seconds) + '，配速 ' + Calc.fmtPaceUnit(run.seconds / run.distance));
      fr.elements.distance.value = ''; fr.elements.h.value = ''; fr.elements.m.value = ''; fr.elements.s.value = '';
      fr.elements.hr.value = ''; fr.elements.note.value = '';
      $('#livePace').textContent = '';
      renderAll();
      if (window.Assistant) window.Assistant.onRunLogged(run);
    });

    /* 跑步筛选 */
    $('#runFilter').addEventListener('change', renderRuns);

    /* 目标表单 */
    $('#goalType').addEventListener('change', function () {
      $('#goalCustomWrap').style.display = this.value === 'custom' ? '' : 'none';
    });
    $('#formGoal').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var type = f.elements.type.value;
      var map = { '3k': 3, '5k': 5, '10k': 10, half: 21.0975, full: 42.195 };
      var km = type === 'custom' ? parseFloat(f.elements.customDistance.value) : map[type];
      if (!(km > 0)) { msg('#goalMsg', '请填写自定义距离', true); return; }
      var sec = durSeconds(f);
      var paceStr = f.elements.pace.value.trim();
      var paceSec = paceStr ? Calc.parsePace(paceStr) : null;
      if (paceStr && !paceSec) { msg('#goalMsg', '目标配速格式请写成 5:30 这样', true); return; }
      if (!sec && paceSec) sec = paceSec * km;
      if (!sec) { msg('#goalMsg', '请填写目标成绩，或填写目标配速', true); return; }
      var label = type === 'custom' ? ('自定义 ' + km + ' km') : ({ '3k': '3 公里', '5k': '5 公里', '10k': '10 公里', half: '半程马拉松 (21.0975 km)', full: '全程马拉松 (42.195 km)' }[type]);
      Store.addGoal({
        type: type, label: label, distanceKm: km,
        targetSeconds: Math.round(sec),
        targetPaceSec: Math.round(sec / km),
        targetDate: f.elements.targetDate.value || null
      });
      msg('#goalMsg', '目标已保存 ✓');
      f.elements.h.value = ''; f.elements.m.value = ''; f.elements.s.value = ''; f.elements.pace.value = '';
      renderAll();
      if (window.Assistant) window.Assistant.onGoalSaved();
    });

    /* 删除（事件委托） */
    document.addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-del-run]'))) {
        if (!confirm('确定删除这条跑步记录吗？')) return;
        Store.removeRun(b.dataset.delRun); renderAll(); toast('已删除');
      } else if ((b = e.target.closest('[data-del-goal]'))) {
        if (!confirm('确定删除这个目标吗？')) return;
        Store.removeGoal(b.dataset.delGoal); renderAll(); toast('目标已删除');
      } else if ((b = e.target.closest('[data-del-body]'))) {
        if (!confirm('确定删除这条身体数据吗？')) return;
        Store.removeBodyRecord(b.dataset.delBody); renderAll(); toast('已删除');
      } else if ((b = e.target.closest('[data-del-report]'))) {
        if (!confirm('确定删除这张图片吗？')) return;
        Store.removeReport(b.dataset.delReport); renderBody(); toast('图片已删除');
      } else if ((b = e.target.closest('[data-cal-date]'))) {
        var ds = b.dataset.calDate;
        if (ds > Store.today()) { toast('还没到那一天哦 😄'); return; }
        var cur = Store.isChecked(ds);
        Store.toggleCheckin(ds, { withRun: Store.runsOn(ds).length > 0 });
        toast(cur ? '已取消 ' + ds + ' 的打卡' : '打卡成功 ' + ds + ' ✅');
        renderAll();
        if (!cur && window.Assistant) window.Assistant.onCheckin(Store.currentStreak());
      }
    });

    /* 日历翻月 */
    $('#calPrev').addEventListener('click', function () {
      calCursor.m--; if (calCursor.m < 0) { calCursor.m = 11; calCursor.y--; } renderCheckin();
    });
    $('#calNext').addEventListener('click', function () {
      calCursor.m++; if (calCursor.m > 11) { calCursor.m = 0; calCursor.y++; } renderCheckin();
    });
    $('#calToday').addEventListener('click', function () {
      calCursor = { y: new Date().getFullYear(), m: new Date().getMonth() }; renderCheckin();
    });
  }

  function msg(sel, text, isErr) {
    var e = $(sel);
    e.textContent = text;
    e.className = 'form-msg' + (isErr ? ' err' : '');
    clearTimeout(e._t);
    e._t = setTimeout(function () { e.textContent = ''; }, 3200);
  }

  function durSeconds(f) {
    var h = parseFloat(f.elements.h && f.elements.h.value) || 0;
    var m = parseFloat(f.elements.m && f.elements.m.value) || 0;
    var s = parseFloat(f.elements.s && f.elements.s.value) || 0;
    return h * 3600 + m * 60 + s;
  }

  /* 图片压缩，避免超出 localStorage 容量 */
  function compressImage(file, maxSize, quality, cb) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { cb(ev.target.result); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ================= 演示数据 ================= */
  function seedDemo() {
    var seed = 20261012;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

    Store.saveProfile({
      name: '小阿跑', gender: 'male', age: 24, height: 175, weight: 68.5,
      bodyFat: null, restHR: 62, activity: 1.375, sleep: 7,
      level: 'intermediate', injury: '无'
    });

    // 按类型匹配的备注，读起来更像真实记录
    var NOTES = {
      easy: ['绕湖一圈，状态不错', '晚饭后慢跑，消食', '操场跑，感觉还行', '清晨跑的，空气很好', '边跑边聊天，很放松'],
      recovery: ['腿有点沉，慢慢跑', '恢复跑，压着心率跑', '昨天强度大了，今天轻松点'],
      tempo: ['节奏跑，稳住配速', '和跑友一起跑的节奏课', '后 3 km 提到阈値附近'],
      interval: ['间歇课，喘得厉害', '8×800m，最后一组咬牙顶住', '间歇跑，跑到怀疑人生'],
      long: ['周末长距离，最后 2 km 加了点速', '长距离，中途补了一次水', '长距离，后半程有点掉速']
    };
    var noteIdx = { easy: 0, recovery: 0, tempo: 0, interval: 0, long: 0 };
    function pickNote(type) {
      var arr = NOTES[type] || NOTES.easy;
      var n = arr[noteIdx[type] % arr.length];
      noteIdx[type]++;
      return n;
    }

    // 按真实周节奏生成：周二轻松 / 周四质量 / 周六长距离 / 周日有时慢跑
    var runs = 0;
    for (var day = -56; day <= -1; day++) {
      var date = Store.addDays(Store.today(), day);
      var dow = Store.parseDate(date).getDay();   // 0=周日 6=周六
      var prog = (day + 56) / 55;                 // 0 → 1 进步曲线
      var type = null, km = 0, hrBase = 145;

      if (dow === 6) { type = 'long'; km = 9 + rnd() * 4; hrBase = 152; }
      else if (dow === 4) { type = (rnd() < 0.5 ? 'tempo' : 'interval'); km = type === 'tempo' ? 7 + rnd() * 1.5 : 6 + rnd() * 1; hrBase = type === 'tempo' ? 168 : 176; }
      else if (dow === 2) { type = (rnd() < 0.25 ? 'recovery' : 'easy'); km = type === 'recovery' ? 4 + rnd() : 5 + rnd() * 2; }
      else if (dow === 0 && rnd() < 0.55) { type = 'easy'; km = 4.5 + rnd() * 1.5; }
      else continue;

      km = Math.round(km * 10) / 10;
      var basePace = 375 - prog * 55;
      var pace = basePace + (rnd() - .5) * 24
        + (type === 'interval' ? -22 : type === 'tempo' ? -8 : type === 'long' ? 12 : type === 'recovery' ? 18 : 0);
      var rpe = type === 'interval' ? 9 : type === 'tempo' ? 7 : type === 'long' ? 6 : type === 'recovery' ? 2 : 4;

      Store.addRun({
        date: date, type: type, distance: km,
        seconds: Math.round(pace * km),
        hr: Math.round(hrBase + (rnd() - .5) * 6),
        rpe: rpe, note: pickNote(type)
      });
      Store.checkin(date, { withRun: true });
      runs++;
    }

    // 休息日也坚持打卡，并让"当前连续"好看一些
    [-14, -11, -8, -5, -3, -2, -1].forEach(function (d) { Store.checkin(Store.addDays(Store.today(), d), {}); });

    // 身体数据历史（体重缓慢下降）
    var weights = [70.8, 70.1, 69.6, 69.0, 68.5];
    weights.forEach(function (w, idx) {
      Store.addBodyRecord({
        date: Store.addDays(Store.today(), -56 + idx * 14),
        weight: w, bodyFat: null, restHR: 68 - idx * 2,
        note: idx === weights.length - 1 ? '最近状态不错' : ''
      });
    });

    // 一个目标
    Store.addGoal({
      type: '5k', label: '5 公里', distanceKm: 5,
      targetSeconds: 24 * 60, targetPaceSec: 288, targetDate: null
    });
  }

  function renderDemoBanner() {
    var el = $('#demoBanner');
    if (!el) return;
    if (!Store.getUI().demo) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="card" style="background:linear-gradient(120deg,#fff8f3,#eef7ff);border-color:#ffdcc8;margin-bottom:16px">' +
      '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
      '<div style="font-size:26px">👋</div>' +
      '<div style="flex:1;min-width:220px">' +
      '<div style="font-weight:700;font-size:14px">当前展示的是演示数据</div>' +
      '<div style="font-size:12.5px;color:#41506a;margin-top:3px">为了让你先看到完整效果，我放了一份 8 周的模拟跑步记录。开始记录自己的数据前，先清空它吧。</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" id="btnClearDemo">清空演示数据</button></div></div>';
    $('#btnClearDemo').addEventListener('click', function () {
      if (!confirm('确定清空演示数据吗？清空后可以开始记录你自己的数据。')) return;
      Store.resetAll();
      Store.setUI('seeded', true);
      Store.setUI('demo', false);
      renderAll();
      switchTab('body');
      toast('演示数据已清空，开始记录你自己的数据吧 🏃');
    });
  }

  /* ================= 数据管理 ================= */
  function bindDataManage() {
    $('#btnExport').addEventListener('click', function () {
      var blob = new Blob([Store.exportAll()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '跑者搭档-备份-' + Store.today() + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      msg('#dataMsg', '已导出备份文件');
    });

    $('#btnImport').addEventListener('click', function () { $('#fileImport').click(); });
    $('#fileImport').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          Store.importAll(e.target.result);
          Store.setUI('demo', false);
          renderAll();
          fillProfileForm();
          msg('#dataMsg', '导入成功 ✓');
          toast('数据导入成功');
        } catch (err) {
          msg('#dataMsg', '导入失败：文件格式不正确', true);
        }
      };
      reader.readAsText(f);
      this.value = '';
    });

    $('#btnReset').addEventListener('click', function () {
      if (!confirm('确定清空全部数据吗？身体信息、跑步记录、目标、打卡都会删除，且无法恢复。建议先导出备份。')) return;
      if (!confirm('再确认一次：真的要全部清空吗？')) return;
      Store.resetAll();
      Store.setUI('seeded', true);
      Store.setUI('demo', false);
      renderAll();
      fillProfileForm();
      msg('#dataMsg', '已清空全部数据');
      toast('已清空，可以重新开始了');
    });
  }

  /* ================= 从 Keep / 运动 App 导入 ================= */
  var impState = { runs: [], failed: [], source: '' };

  var DEMO_IMPORT_TEXT = [
    '我刚刚用 Keep 跑了 5.00 公里，用时 26 分 30 秒，平均配速 5\'18"，消耗 312 千卡',
    '#KeepRunning 8.02km | 42:15 | 5\'16"/km | 平均心率 156',
    '2026/10/05 今天完成了 12.5 公里的长距离跑，用时 1 小时 10 分 20 秒，配速 5\'37"/km'
  ].join('\n\n');

  function bindImport() {
    var tabs = $$('.imp-tab');
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        $('#impPaneText').style.display = b.dataset.imp === 'text' ? '' : 'none';
        $('#impPaneFile').style.display = b.dataset.imp === 'file' ? '' : 'none';
      });
    });

    $('#impParseText').addEventListener('click', function () {
      var txt = $('#impText').value;
      if (!txt.trim()) { msg('#impTextMsg', '先把分享文案粘贴进来', true); return; }
      var res = Importer.parseText(txt);
      msg('#impTextMsg', '解析出 ' + res.runs.length + ' 条');
      showImportPreview(res.runs, res.failed, '分享文本');
    });

    $('#impDemoText').addEventListener('click', function () {
      $('#impText').value = DEMO_IMPORT_TEXT;
      msg('#impTextMsg', '已填入示例，点「解析文本」看看效果');
    });

    var dz = $('#dropZone'), fi = $('#impFile');
    dz.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () { readImportFiles(this.files); this.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) readImportFiles(e.dataTransfer.files);
    });

    /* 预览区的交互（事件委托） */
    $('#impPreview').addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('#impDoImport')) { doImport(); return; }
      if (t.closest('#impAll')) {
        impState.runs.forEach(function (r) { r._keep = true; });
        renderImportPreview(); return;
      }
      if (t.closest('#impNone')) {
        impState.runs.forEach(function (r) { r._keep = false; });
        renderImportPreview(); return;
      }
      if (t.closest('#impKeepNew')) {
        impState.runs.forEach(function (r) { r._keep = !r._dup; });
        renderImportPreview(); return;
      }
      if (t.closest('#impCancel')) {
        impState = { runs: [], failed: [], source: '' };
        renderImportPreview(); return;
      }
    });
    $('#impPreview').addEventListener('change', function (e) {
      var cb = e.target.closest('[data-imp-idx]');
      if (cb) {
        var i = parseInt(cb.dataset.impIdx, 10);
        if (impState.runs[i]) impState.runs[i]._keep = cb.checked;
        updateImportCount();
      }
    });
  }

  function readImportFiles(files) {
    if (!files || !files.length) return;
    var pending = files.length, all = [], failed = [], names = [];

    Array.prototype.forEach.call(files, function (f) {
      names.push(f.name);
      var reader = new FileReader();
      reader.onload = function (e) {
        var res;
        try {
          res = Importer.parse(f.name, e.target.result);
        } catch (err) {
          res = { runs: [], failed: ['解析出错：' + err.message] };
        }
        res.runs.forEach(function (r) {
          r.note = (r.note ? r.note + ' ' : '') + '（' + f.name + '）';
          all.push(r);
        });
        res.failed.forEach(function (x) { failed.push(f.name + ' → ' + x); });
        if (--pending === 0) finish();
      };
      reader.onerror = function () {
        failed.push(f.name + ' → 文件读取失败');
        if (--pending === 0) finish();
      };
      reader.readAsText(f, 'utf-8');
    });

    function finish() {
      if (!all.length) {
        msg('#impFileMsg', '没能从这些文件里解析出跑步记录', true);
        showImportPreview([], failed, names.join('、'));
        return;
      }
      msg('#impFileMsg', '解析完成，共 ' + all.length + ' 条');
      showImportPreview(all, failed, names.join('、'));
    }
  }

  function showImportPreview(runs, failed, source) {
    impState.runs = Importer.markDuplicates(runs, Store.getRuns());
    impState.failed = failed || [];
    impState.source = source || '';
    renderImportPreview();
  }

  function renderImportPreview() {
    var el = $('#impPreview');
    if (!el) return;
    var rs = impState.runs;

    if (!rs.length) {
      el.innerHTML = impState.failed.length
        ? '<div class="imp-summary bad">没有解析出可导入的记录</div>' + failHtml()
        : '';
      return;
    }

    var dupN = rs.filter(function (r) { return r._dup; }).length;
    var rows = rs.map(function (r, i) {
      var t = RUN_TYPE[r.type] || RUN_TYPE.easy;
      return '<tr>' +
        '<td><input type="checkbox" data-imp-idx="' + i + '"' + (r._keep ? ' checked' : '') + ' style="width:15px;height:15px;accent-color:#ff6a3d"></td>' +
        '<td>' + esc(r.date) + (r._dup ? ' <span class="imp-dup">疑似重复</span>' : '') + '</td>' +
        '<td class="num">' + r.distance + ' km</td>' +
        '<td class="num">' + Calc.fmtDur(r.seconds) + '</td>' +
        '<td class="num">' + Calc.fmtPaceUnit(r.seconds / r.distance) + '</td>' +
        '<td class="num">' + (r.hr || '--') + '</td>' +
        '<td>' + badge(t.label, t.key) + '</td>' +
        '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7c8ba3">' + esc(r.note || '') + '</td>' +
        '</tr>';
    }).join('');

    el.innerHTML =
      '<div class="imp-summary" id="impSummary">' +
      '<span>📥 解析出 <b id="impTotal">' + rs.length + '</b> 条记录' +
      (dupN ? '，其中 <b>' + dupN + '</b> 条与已有记录疑似重复（默认不勾选）' : '') +
      '　来源：' + esc(impState.source) + '</span>' +
      '</div>' +
      '<div class="imp-table-wrap"><table class="tbl"><thead><tr>' +
      '<th style="width:34px"></th><th>日期</th><th>距离</th><th>用时</th><th>配速</th><th>心率</th><th>类型</th><th>备注</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="imp-ctrl">' +
      '<button class="btn btn-primary btn-sm" id="impDoImport">导入勾选的 <span id="impCount">' + rs.filter(function (r) { return r._keep; }).length + '</span> 条</button>' +
      '<button class="btn btn-ghost btn-sm" id="impKeepNew">只选新记录</button>' +
      '<button class="btn btn-ghost btn-sm" id="impAll">全选</button>' +
      '<button class="btn btn-ghost btn-sm" id="impNone">全不选</button>' +
      '<button class="btn btn-ghost btn-sm" id="impCancel">取消</button>' +
      '</div>' +
      failHtml();
  }

  function failHtml() {
    if (!impState.failed || !impState.failed.length) return '';
    return '<div class="imp-fail"><b>以下内容没能识别，已跳过：</b><br>' +
      impState.failed.slice(0, 8).map(function (f) { return '· ' + esc(f); }).join('<br>') +
      (impState.failed.length > 8 ? '<br>· …还有 ' + (impState.failed.length - 8) + ' 条' : '') +
      '</div>';
  }

  function updateImportCount() {
    var n = impState.runs.filter(function (r) { return r._keep; }).length;
    var el = $('#impCount');
    if (el) el.textContent = n;
    var btn = $('#impDoImport');
    if (btn) btn.disabled = n === 0;
  }

  function doImport() {
    var keep = impState.runs.filter(function (r) { return r._keep; });
    if (!keep.length) { toast('至少勾选一条记录'); return; }
    var n = 0;
    keep.forEach(function (r) {
      Store.addRun({
        date: r.date, type: r.type, distance: r.distance, seconds: r.seconds,
        hr: r.hr || null, rpe: null, note: r.note || ''
      });
      Store.checkin(r.date, { withRun: true });
      n++;
    });
    impState = { runs: [], failed: [], source: '' };
    $('#impPreview').innerHTML = '';
    $('#impText').value = '';
    msg('#impTextMsg', '已导入 ' + n + ' 条');
    msg('#impFileMsg', '已导入 ' + n + ' 条');
    renderAll();
    toast('成功导入 ' + n + ' 条跑步记录 🎉');
    if (window.Assistant) window.Assistant.onImported(n);
  }

  /* ================= 启动 ================= */
  function init() {
    bindEvents();
    bindImport();
    fillProfileForm();

    // 首次打开：载入演示数据，让用户先看到完整效果
    var st = Store.getState();
    if (!Store.getUI().seeded && !st.runs.length && !st.profile.updatedAt) {
      seedDemo();
      Store.setUI('seeded', true);
      Store.setUI('demo', true);
    }

    recompute();
    renderDemoBanner();
    renderAll();
    bindDataManage();
    fillProfileForm();

    // 支持通过链接直接打开某个页面，例如 index.html?tab=train
    // 没有指定时，默认落在「智能教练搭子」——打开网页先看到对话
    var urlTab = (location.search.match(/[?&]tab=([a-z]+)/) || [])[1];
    if (urlTab && ($('#view-' + urlTab) || GROUPS[urlTab])) switchTab(urlTab);
    else switchTab('agent');
    if (window.Assistant) window.Assistant.init();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.App = { renderAll: renderAll, switchTab: switchTab, cache: cache };
})();
