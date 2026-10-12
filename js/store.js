/* ============================================================
   store.js — 本地数据层（localStorage 持久化）
   所有数据仅保存在用户浏览器，不上传任何服务器。
   ============================================================ */

var Store = (function () {

  var KEY = 'runmate_v1';
  var state = null;
  var listeners = [];

  /* ---------------- 工具 ---------------- */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function today() { return dateStr(new Date()); }
  function parseDate(s) {
    var p = String(s || '').split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  }
  function daysBetween(a, b) {
    var d1 = parseDate(a), d2 = parseDate(b);
    return Math.round((d2 - d1) / 86400000);
  }
  function addDays(s, n) {
    var d = parseDate(s);
    d.setDate(d.getDate() + n);
    return dateStr(d);
  }

  /* ---------------- 默认结构 ---------------- */
  function defaults() {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      profile: {
        name: '', gender: 'male', age: null, height: null, weight: null,
        bodyFat: null, restHR: null, activity: 1.375, sleep: null,
        level: 'intermediate', injury: '', updatedAt: null
      },
      bodyRecords: [],
      runs: [],
      goals: [],
      reports: [],
      checkins: {},
      ui: { lastTab: 'dash' }
    };
  }

  /* ---------------- 读写 ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      var d = JSON.parse(raw);
      var base = defaults();
      Object.keys(base).forEach(function (k) {
        if (d[k] === undefined || d[k] === null) d[k] = base[k];
      });
      Object.keys(base.profile).forEach(function (k) {
        if (d.profile[k] === undefined) d.profile[k] = base.profile[k];
      });
      return d;
    } catch (e) {
      console.warn('读取本地数据失败，已重置', e);
      return defaults();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('保存失败（可能是图片过大超出浏览器容量）', e);
      toastSafe('保存失败：本地存储已满，请删除部分上传图片');
    }
  }

  function toastSafe(msg) {
    if (typeof window !== 'undefined' && typeof window.toast === 'function') window.toast(msg);
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
  }

  function commit() { save(); emit(); }

  /* ---------------- 初始化 ---------------- */
  state = load();

  /* ---------------- 订阅 ---------------- */
  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }

  /* ---------------- 身体档案 ---------------- */
  function getProfile() { return state.profile; }

  function saveProfile(p) {
    Object.keys(p).forEach(function (k) { state.profile[k] = p[k]; });
    state.profile.updatedAt = new Date().toISOString();
    commit();
    return state.profile;
  }

  function getBodyRecords() {
    return state.bodyRecords.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function latestBodyRecord() { return getBodyRecords()[0] || null; }

  function addBodyRecord(rec) {
    rec.id = rec.id || uid();
    rec.createdAt = new Date().toISOString();
    state.bodyRecords.push(rec);
    // 同步最新一条到 profile
    ['weight', 'bodyFat', 'restHR'].forEach(function (k) {
      if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') state.profile[k] = rec[k];
    });
    commit();
    return rec;
  }
  function removeBodyRecord(id) {
    state.bodyRecords = state.bodyRecords.filter(function (r) { return r.id !== id; });
    commit();
  }

  /* ---------------- 上传资料 ---------------- */
  function getReports() {
    return state.reports.slice().sort(function (a, b) { return a.addedAt < b.addedAt ? 1 : -1; });
  }
  function addReport(rep) {
    rep.id = rep.id || uid();
    rep.addedAt = new Date().toISOString();
    state.reports.push(rep);
    // 最多保留 12 张，避免超出浏览器容量
    if (state.reports.length > 12) state.reports = state.reports.slice(-12);
    commit();
    return rep;
  }
  function removeReport(id) {
    state.reports = state.reports.filter(function (r) { return r.id !== id; });
    commit();
  }

  /* ---------------- 跑步记录 ---------------- */
  function getRuns() {
    return state.runs.slice().sort(function (a, b) {
      if (a.date === b.date) return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1;
      return a.date < b.date ? 1 : -1;
    });
  }
  function addRun(run) {
    run.id = run.id || uid();
    run.createdAt = new Date().toISOString();
    state.runs.push(run);
    commit();
    return run;
  }
  function removeRun(id) {
    state.runs = state.runs.filter(function (r) { return r.id !== id; });
    commit();
  }
  function runsSince(days) {
    var from = addDays(today(), -(days - 1));
    return getRuns().filter(function (r) { return r.date >= from; });
  }
  function runsOn(date) {
    return getRuns().filter(function (r) { return r.date === date; });
  }

  /* ---------------- 目标 ---------------- */
  function getGoals() {
    return state.goals.slice().sort(function (a, b) { return (a.createdAt || '') > (b.createdAt || '') ? 1 : -1; });
  }
  function addGoal(g) {
    g.id = g.id || uid();
    g.createdAt = new Date().toISOString();
    state.goals.push(g);
    commit();
    return g;
  }
  function removeGoal(id) {
    state.goals = state.goals.filter(function (g) { return g.id !== id; });
    commit();
  }

  /* ---------------- 打卡 ---------------- */
  function getCheckins() { return state.checkins; }
  function isChecked(date) { return !!state.checkins[date]; }
  function toggleCheckin(date, extra) {
    date = date || today();
    if (state.checkins[date]) {
      delete state.checkins[date];
    } else {
      state.checkins[date] = {
        ts: new Date().toISOString(),
        note: (extra && extra.note) || '',
        withRun: !!(extra && extra.withRun)
      };
    }
    commit();
    return state.checkins[date];
  }
  function checkin(date, extra) {
    date = date || today();
    if (!state.checkins[date]) {
      state.checkins[date] = {
        ts: new Date().toISOString(),
        note: (extra && extra.note) || '',
        withRun: !!(extra && extra.withRun)
      };
      commit();
    }
    return state.checkins[date];
  }
  function checkedCount() { return Object.keys(state.checkins).length; }
  function currentStreak() {
    var n = 0, d = today();
    // 若今天还没打卡，从昨天开始算
    if (!state.checkins[d]) d = addDays(d, -1);
    while (state.checkins[d]) { n++; d = addDays(d, -1); }
    return n;
  }
  function maxStreak() {
    var keys = Object.keys(state.checkins).sort();
    if (!keys.length) return 0;
    var best = 1, cur = 1;
    for (var i = 1; i < keys.length; i++) {
      if (daysBetween(keys[i - 1], keys[i]) === 1) { cur++; best = Math.max(best, cur); }
      else cur = 1;
    }
    return best;
  }

  /* ---------------- UI 状态 ---------------- */
  function getUI() { return state.ui; }
  function setUI(k, v) { state.ui[k] = v; save(); }

  /* ---------------- 导入 / 导出 / 清空 ---------------- */
  function exportAll() { return JSON.stringify(state, null, 2); }
  function importAll(json) {
    var d = JSON.parse(json);
    if (!d || typeof d !== 'object') throw new Error('数据格式不正确');
    state = d;
    var base = defaults();
    Object.keys(base).forEach(function (k) { if (state[k] === undefined) state[k] = base[k]; });
    commit();
  }
  function clearRuns() { state.runs = []; commit(); }
  function resetAll() { state = defaults(); commit(); }

  return {
    uid: uid, dateStr: dateStr, today: today, parseDate: parseDate,
    addDays: addDays, daysBetween: daysBetween,
    getState: function () { return state; },
    subscribe: subscribe,
    getProfile: getProfile, saveProfile: saveProfile,
    getBodyRecords: getBodyRecords, latestBodyRecord: latestBodyRecord,
    addBodyRecord: addBodyRecord, removeBodyRecord: removeBodyRecord,
    getReports: getReports, addReport: addReport, removeReport: removeReport,
    getRuns: getRuns, addRun: addRun, removeRun: removeRun,
    runsSince: runsSince, runsOn: runsOn,
    getGoals: getGoals, addGoal: addGoal, removeGoal: removeGoal,
    getCheckins: getCheckins, isChecked: isChecked, toggleCheckin: toggleCheckin,
    checkin: checkin, checkedCount: checkedCount,
    currentStreak: currentStreak, maxStreak: maxStreak,
    getUI: getUI, setUI: setUI,
    exportAll: exportAll, importAll: importAll,
    clearRuns: clearRuns, resetAll: resetAll
  };
})();
