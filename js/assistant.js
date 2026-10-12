/* ============================================================
   assistant.js — 悬浮智能小助手「小跑」
   行为：
   · 每次打开网页 → 打招呼
   · 每 3-4 分钟（随机）弹一条短消息：天气 / 激励 / 训练小贴士 / 打卡提醒
   · 记录跑步、完成打卡、保存目标后 → 立即给一次针对性反馈
   · 点击助手 → 打开聊天面板，可以**直接打字提问**（由 chat.js 基于你自己的数据回答）
   · 页面切到后台时暂停，回到前台重新计时，避免消息堆积
   ============================================================ */

var Assistant = (function () {

  var NAME = '小跑';
  var TICK_MIN = 180000;   // 3 分钟
  var TICK_MAX = 240000;   // 4 分钟
  var FIRST_DELAY_MIN = 60000;
  var FIRST_DELAY_MAX = 90000;
  var HIDE_MIN = 7000;
  var HIDE_MAX = 14000;
  var CHAT_MAX = 60;

  var timer = null, hideTimer = null, started = false, typing = false;
  var lastText = '';
  var weather = null;
  var log = [];            // [{role:'bot'|'me', ico, text, ts}]

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function timeStr(ts) {
    var d = new Date(ts);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  /* ---------------- Q 版助手图形 ---------------- */
  function svgMarkup() {
    return ''
      + '<defs>'
      + '<radialGradient id="abBody" cx="36%" cy="26%" r="82%">'
      + '<stop offset="0%" stop-color="#fff6f0"/>'
      + '<stop offset="52%" stop-color="#ffdcc6"/>'
      + '<stop offset="100%" stop-color="#ffb388"/>'
      + '</radialGradient>'
      + '<linearGradient id="abBand" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0%" stop-color="#ff9a6a"/><stop offset="100%" stop-color="#ff5c39"/>'
      + '</linearGradient>'
      + '<radialGradient id="abShine" cx="50%" cy="50%" r="50%">'
      + '<stop offset="0%" stop-color="#ffffff" stop-opacity=".85"/>'
      + '<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>'
      + '</radialGradient>'
      + '</defs>'
      + '<circle cx="60" cy="60" r="58" fill="url(#abBody)"/>'
      + '<ellipse cx="42" cy="34" rx="20" ry="14" fill="url(#abShine)"/>'
      + '<path d="M60 20 q3 -11 13 -13" stroke="url(#abBand)" stroke-width="4.2" fill="none" stroke-linecap="round"/>'
      + '<circle cx="75" cy="6.5" r="4" fill="#ff8a5c"/>'
      + '<path d="M25 46 Q60 13 95 46" stroke="url(#abBand)" stroke-width="9" fill="none" stroke-linecap="round"/>'
      + '<ellipse cx="36" cy="74" rx="9" ry="5.6" fill="#ff8f8f" opacity=".42"/>'
      + '<ellipse cx="84" cy="74" rx="9" ry="5.6" fill="#ff8f8f" opacity=".42"/>'
      + '<g>'
      + '<ellipse cx="46" cy="62" rx="6" ry="7.2" fill="#2b3445">'
      + '<animate attributeName="ry" values="7.2;7.2;0.7;7.2;7.2" keyTimes="0;0.9;0.94;0.98;1" dur="4.6s" repeatCount="indefinite"/>'
      + '</ellipse>'
      + '<ellipse cx="74" cy="62" rx="6" ry="7.2" fill="#2b3445">'
      + '<animate attributeName="ry" values="7.2;7.2;0.7;7.2;7.2" keyTimes="0;0.9;0.94;0.98;1" dur="4.6s" repeatCount="indefinite"/>'
      + '</ellipse>'
      + '<circle cx="44" cy="59" r="2.1" fill="#fff"/>'
      + '<circle cx="72" cy="59" r="2.1" fill="#fff"/>'
      + '</g>'
      + '<path d="M50 76 Q60 85.5 70 76" stroke="#2b3445" stroke-width="2.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M97 68 q4 5 0 8.4 a4 4 0 1 1 -4.6 -8.4 z" fill="#7fd4ff" opacity=".9"/>';
  }

  /* ---------------- 天气 ---------------- */
  var WMO = {
    0: ['晴', '☀️'], 1: ['晴间多云', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
    45: ['有雾', '🌫️'], 48: ['雾凇', '🌫️'],
    51: ['小毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'], 55: ['大毛毛雨', '🌦️'],
    56: ['冻雨', '🌧️'], 57: ['强冻雨', '🌧️'],
    61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
    66: ['冻雨', '🌧️'], 67: ['强冻雨', '🌧️'],
    71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '🌨️'], 77: ['雪粒', '🌨️'],
    80: ['阵雨', '🌦️'], 81: ['强阵雨', '🌧️'], 82: ['暴雨', '⛈️'],
    85: ['阵雪', '🌨️'], 86: ['强阵雪', '🌨️'],
    95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['强雷暴冰雹', '⛈️']
  };
  function wmoText(code) { return (WMO[code] || ['未知', '🌡️']); }

  function canFetch() { return typeof fetch === 'function'; }

  function getLocation(cb) {
    try {
      var cached = localStorage.getItem('runmate_geo');
      if (cached) {
        var c = JSON.parse(cached);
        if (c && c.lat && (Date.now() - (c.ts || 0)) < 7 * 86400000) { cb(c); return; }
      }
    } catch (e) { }

    var done = false;
    var finish = function (loc) {
      if (done) return; done = true;
      loc.ts = Date.now();
      try { localStorage.setItem('runmate_geo', JSON.stringify(loc)); } catch (e) { }
      cb(loc);
    };
    var fallback = { lat: 22.5176, lon: 113.3928, city: '中山' };

    if (!canFetch()) { finish(fallback); return; }

    var timeout = setTimeout(function () { finish(fallback); }, 5000);

    fetch('https://ipwho.is/')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        clearTimeout(timeout);
        if (d && d.success !== false && d.latitude) {
          finish({ lat: d.latitude, lon: d.longitude, city: d.city || d.region || '当前位置' });
        } else {
          throw new Error('bad');
        }
      })
      .catch(function () {
        clearTimeout(timeout);
        finish(fallback);
      });
  }

  function fetchWeather(cb) {
    if (weather && Date.now() - weather.ts < 30 * 60 * 1000) { cb(weather); return; }
    if (!canFetch()) { cb(null); return; }
    getLocation(function (loc) {
      var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon
        + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m'
        + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
        + '&timezone=auto&forecast_days=1';
      fetch(url).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || !d.current) { cb(null); return; }
        var t = wmoText(d.current.weather_code);
        weather = {
          city: loc.city,
          temp: Math.round(d.current.temperature_2m),
          feels: Math.round(d.current.apparent_temperature),
          humidity: d.current.relative_humidity_2m,
          wind: Math.round(d.current.wind_speed_10m),
          code: d.current.weather_code,
          text: t[0], emoji: t[1],
          tmax: d.daily ? Math.round(d.daily.temperature_2m_max[0]) : null,
          tmin: d.daily ? Math.round(d.daily.temperature_2m_min[0]) : null,
          pop: d.daily && d.daily.precipitation_probability_max ? d.daily.precipitation_probability_max[0] : null,
          ts: Date.now()
        };
        cb(weather);
      }).catch(function () { cb(null); });
    });
  }

  function weatherLine(w) {
    return w.city + '今天 ' + w.emoji + ' ' + w.text + '，气温 ' + w.temp + '℃' +
      (w.tmax !== null ? '（' + w.tmin + '~' + w.tmax + '℃）' : '') +
      (w.feels !== w.temp ? '，体感 ' + w.feels + '℃' : '') + '。';
  }

  function weatherAdvice(w) {
    if (w.code >= 95) return '有雷雨，安全第一，今天别出门跑步哦 ⛈️';
    if (w.temp >= 32) return '高温天气！尽量清晨或晚上跑，配速放慢 30 秒以上，水必须带够 💧';
    if (w.temp >= 28) return '有点热，挑早晚出门，配速放慢 20-30 秒，跑前先喝 300 ml 水。';
    if (w.temp <= 0) return '零下气温，注意保暖和防滑，热身时间加长到 15 分钟。';
    if (w.temp <= 5) return '气温偏低，热身加到 12 分钟，穿分层衣物，跑热了再脱。';
    if (w.pop !== null && w.pop >= 70) return '降雨概率 ' + w.pop + '%，路面会滑，建议改跑步机或者干脆休息一天～';
    if (/雨|雪/.test(w.text)) return '有降水，穿防滑的鞋，跑完立刻换干衣服别着凉。';
    if (w.wind >= 25) return '风有点大，尽量选有遮挡的路线，逆风段别硬扛配速。';
    if (w.humidity >= 85) return '湿度高，汗排不出去，提前补水、配速放慢一点。';
    if (w.temp >= 12 && w.temp <= 24) return '温度刚刚好，是跑步的黄金天气，别浪费了 🏃';
    return '适合跑步的天气，出门前记得热身 8 分钟。';
  }

  /* ---------------- 主动消息内容 ---------------- */
  function greeting() {
    var p = Store.getProfile();
    var h = new Date().getHours();
    var when = h < 5 ? '这么晚还没睡呀' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了';
    var name = p.name || '跑者';
    var today = Store.today();
    var runs = Store.runsOn(today);
    var tail;
    if (runs.length) {
      tail = '今天已经跑了 ' + Calc.totalKm(runs) + ' km 啦，很棒！';
    } else if (Store.isChecked(today)) {
      tail = '今天打过卡了 ✅ 有跑步的话记得补一条记录。';
    } else {
      var streak = Store.currentStreak();
      tail = streak >= 3
        ? '你已经连续打卡 ' + streak + ' 天，今天也别忘了哦 🔥'
        : '今天还没打卡，等会儿一起动起来吧 🏃';
    }
    return { ico: '👋', text: when + '，' + name + '！我是' + NAME + '，你的跑步搭档。' + tail + ' 点我就能直接问我问题。' };
  }

  function runFeedback(run) {
    var pace = run.seconds / run.distance;
    var km = run.distance;
    var parts = [];
    parts.push('收到！' + km + ' km / ' + Calc.fmtDur(run.seconds) + '，配速 ' + Calc.fmtPaceUnit(pace) + '。');

    var all = Store.getRuns().filter(function (r) { return r.id !== run.id; });
    var sameType = all.filter(function (r) { return r.type === run.type; });
    var base = sameType.length >= 2 ? Calc.avgPaceOf(sameType) : Calc.avgPaceOf(all);
    if (base) {
      var diff = pace - base;
      if (diff <= -6) parts.push('比同类跑步的平均配速快了 ' + Math.abs(Math.round(diff)) + ' 秒，状态在往好的方向走 💪');
      else if (diff >= 6) parts.push('比平均水平慢了 ' + Math.round(diff) + ' 秒。如果是刻意放松跑那没问题；想跑快却没跑动，注意休息和补给。');
      else parts.push('和你的平均水平基本持平，很稳。');
    }

    var total = Calc.totalKm(Store.getRuns());
    if (total >= 100 && total - km < 100) parts.push('恭喜！累计跑量突破 100 km 了 🎉');
    else if (total >= 50 && total - km < 50) parts.push('累计跑量到 50 km 啦，继续加油！');
    else if (total >= 10 && total - km < 10) parts.push('累计跑量破 10 km，开个好头 ✨');

    if (km >= 15) parts.push('长距离跑完记得补充蛋白质和碳水，今晚早点睡。');
    else if (run.rpe >= 8) parts.push('这次体感强度挺高，明天安排轻松跑或休息，别连着拼。');
    else if (run.rpe <= 3 && run.type === 'easy') parts.push('轻松跑就该这么跑，能聊天就对了 👌');

    if (run.hr) {
      var mhr = Calc.maxHR(Store.getProfile().age);
      if (mhr) {
        var pct = run.hr / mhr;
        if (pct > 0.9 && run.type === 'easy') parts.push('轻松跑的平均心率到最大心率的 ' + Math.round(pct * 100) + '% 了，说明跑快了，下次再慢一点。');
      }
    }
    return { ico: '🏃', text: parts.join(' ') };
  }

  function checkinFeedback(streak) {
    var t;
    if (streak >= 30) t = '连续打卡 ' + streak + ' 天！！这已经是生活方式了，不是坚持 🙌';
    else if (streak >= 14) t = '连续打卡两周，' + streak + ' 天！这种稳定是进步最快的秘诀。';
    else if (streak >= 7) t = '连续打卡一周啦（' + streak + ' 天），身体已经开始记住这个节奏了 ⭐';
    else if (streak >= 3) t = '连续 ' + streak + ' 天打卡，很好，保持住 🔥';
    else t = '打卡成功 ✅ 第一步永远是最难的，你已经迈出去了。';
    return { ico: '✅', text: t };
  }

  function goalFeedback() {
    var goals = Store.getGoals();
    if (!goals.length) return null;
    var g = goals[goals.length - 1];
    var pace = g.targetSeconds / g.distanceKm;
    var pred = Calc.racePredict(Store.getRuns());
    var txt = '目标记下了：' + g.label + ' 跑进 ' + Calc.fmtDur(g.targetSeconds) + '，也就是 ' + Calc.fmtPaceUnit(pace) + '。';
    if (pred['10k']) {
      var cur = pred[g.type] ? pred[g.type].seconds : Calc.riegel(pred['10k'].seconds, 10, g.distanceKm);
      if (cur) {
        var gap = cur - g.targetSeconds;
        txt += gap <= 0 ? '按你现在的水平其实已经能跑到了，可以考虑再加点难度 😏'
          : '按当前预测你还差 ' + Calc.fmtDur(gap) + '，我把课表按这个目标重新排了一版，去「训练推荐」看看。';
      }
    } else {
      txt += '多记几次跑步，我就能算出你离目标还有多远。';
    }
    return { ico: '🎯', text: txt };
  }

  function dynamicMessages() {
    var pool = [];
    var today = Store.today();
    var runs = Store.getRuns();

    if (weather) pool.push({ ico: weather.emoji, text: weatherLine(weather) + weatherAdvice(weather) });

    if (!Store.isChecked(today) && new Date().getHours() >= 17) {
      pool.push({ ico: '⏰', text: '今天还没打卡哦，睡前花 2 秒打个卡吧，别断了记录～' });
    }

    if (runs.length) {
      var last = runs[0];
      var gapDays = Store.daysBetween(last.date, today);
      if (gapDays >= 4) pool.push({ ico: '🐢', text: '已经 ' + gapDays + ' 天没跑步记录了，状态是会掉的。今天先从 20 分钟轻松跑开始找找感觉？' });
      else if (gapDays <= 1) pool.push({ ico: '📈', text: '最近一次是 ' + last.date + ' 的 ' + last.distance + ' km，节奏保持得不错。' });
    } else {
      pool.push({ ico: '🚶', text: '还没有跑步记录呢。第一次不用多，20 分钟慢跑就足够开启这一切了。' });
    }

    var ev = Calc.evaluateBody(Store.getProfile(), runs, Store.getCheckins());
    if (ev.metrics && Calc.isNum(ev.metrics.weeklyAvgKm) && ev.metrics.weeklyAvgKm > 0 && ev.metrics.weeklyAvgKm < 10) {
      pool.push({ ico: '📊', text: '目前周均 ' + ev.metrics.weeklyAvgKm + ' km，先别管配速，把跑量稳稳提到 15 km 会更有效。' });
    }

    var tips = Coach.tips(Store.getProfile(), ev, runs);
    var dayIdx = (new Date().getDate() + new Date().getHours()) % tips.length;
    pool.push({ ico: '💡', text: tips[dayIdx] });
    pool.push({ ico: '💡', text: tips[(dayIdx + 5) % tips.length] });

    var enc = Coach.encouragements();
    pool.push({ ico: '✨', text: enc[(new Date().getMinutes() + new Date().getDate()) % enc.length] });
    pool.push({ ico: '💬', text: '有问题随时问我，比如「我该怎么练」「今天适合跑步吗」。' });

    return pool;
  }

  /* ---------------- 聊天气泡渲染 ---------------- */
  function panelOpen() {
    var p = $('#assistantPanel');
    return !!(p && p.classList.contains('show'));
  }

  function scrollLog() {
    var el = $('#chatLog');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function renderChat() {
    var el = $('#chatLog');
    if (!el) return;
    if (!log.length) {
      el.innerHTML = '<div class="chat-empty">嗨，我是小跑 👋<br>可以直接打字问我，比如<br>「这周跑了多少」「我该怎么练」</div>';
      return;
    }
    var html = log.map(function (m) {
      if (m.role === 'me') {
        return '<div class="chat-row me">' +
          '<div class="chat-avatar">🙂</div>' +
          '<div><div class="chat-bubble">' + esc(m.text) + '</div>' +
          '<div class="chat-time" style="text-align:right">' + timeStr(m.ts) + '</div></div></div>';
      }
      return '<div class="chat-row">' +
        '<div class="chat-avatar">' + (m.ico || '💬') + '</div>' +
        '<div><div class="chat-bubble">' + esc(m.text) + '</div>' +
        '<div class="chat-time">' + timeStr(m.ts) + '</div></div></div>';
    }).join('');
    if (typing) {
      html += '<div class="chat-row" id="typingRow">' +
        '<div class="chat-avatar">🤔</div>' +
        '<div class="chat-bubble typing"><i></i><i></i><i></i></div></div>';
    }
    el.innerHTML = html;
    scrollLog();
  }

  function renderQuick() {
    var el = $('#chatQuick');
    if (!el) return;
    var list = Chat.suggestions().slice(0, 4);
    list.push('你能做什么');
    el.innerHTML = list.map(function (q) {
      return '<button class="chat-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');
  }

  function saveChat() {
    try { Store.setUI('chatLog', log.slice(-CHAT_MAX)); } catch (e) { }
  }
  function loadChat() {
    var saved = Store.getUI().chatLog;
    if (Array.isArray(saved)) log = saved.slice(-CHAT_MAX);
  }

  function addMsg(role, ico, text, noBubble) {
    log.push({ role: role, ico: ico, text: text, ts: Date.now() });
    if (log.length > CHAT_MAX) log = log.slice(-CHAT_MAX);
    saveChat();
    if (panelOpen()) renderChat();
    if (!noBubble && role === 'bot') {
      renderQuick();
      if (!panelOpen()) showBubble(ico, text);
    }
  }

  /* 助手主动说一句：进聊天记录 + 弹气泡 */
  function say(ico, text) {
    if (!text || text === lastText) return;
    lastText = text;
    addMsg('bot', ico, text);
  }

  /* 只弹气泡，不进聊天记录（临时提示用） */
  function showBubble(ico, text) {
    var bubble = $('#assistantBubble');
    if (!bubble) return;
    $('#bubbleText').innerHTML = (ico ? '<b>' + ico + '</b> ' : '') + esc(text);
    bubble.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { bubble.classList.remove('show'); },
      Calc.clamp(HIDE_MIN + text.length * 95, HIDE_MIN, HIDE_MAX));
  }

  function hideBubble() {
    var b = $('#assistantBubble');
    if (b) b.classList.remove('show');
  }

  /* ---------------- 用户提问 ---------------- */
  function ask(question) {
    var q = String(question || '').trim();
    if (!q) return;
    addMsg('me', '', q, true);
    typing = true;
    renderChat();
    var t0 = Date.now();

    Chat.ask(q, function (res) {
      var wait = Math.max(0, 420 - (Date.now() - t0));
      setTimeout(function () {
        typing = false;
        lastText = res.text;
        addMsg('bot', res.ico, res.text);
        renderChat();
      }, wait);
    });
  }

  /* ---------------- 定时节奏 ---------------- */
  function scheduleNext(first) {
    clearTimeout(timer);
    var delay = first ? rand(FIRST_DELAY_MIN, FIRST_DELAY_MAX) : rand(TICK_MIN, TICK_MAX);
    timer = setTimeout(function () {
      if (document.hidden) { scheduleNext(false); return; }
      fire();
      scheduleNext(false);
    }, delay);
  }
  function rand(a, b) { return a + Math.floor(Math.random() * (b - a)); }

  function fire() {
    var pool = dynamicMessages();
    for (var i = 0; i < 5; i++) {
      var m = pool[Math.floor(Math.random() * pool.length)];
      if (!m || m.text === lastText) continue;
      say(m.ico, m.text);
      return;
    }
  }

  /* ---------------- 对外事件 ---------------- */
  function onRunLogged(run) {
    setTimeout(function () {
      var f = runFeedback(run);
      say(f.ico, f.text);
    }, 700);
  }
  function onCheckin(streak) {
    setTimeout(function () {
      var f = checkinFeedback(streak || Store.currentStreak());
      say(f.ico, f.text);
    }, 600);
  }
  function onGoalSaved() {
    setTimeout(function () {
      var f = goalFeedback();
      if (f) say(f.ico, f.text);
    }, 700);
  }
  function onProfileSaved() {
    setTimeout(function () {
      var ev = Calc.evaluateBody(Store.getProfile(), Store.getRuns(), Store.getCheckins());
      say('🧭', '身体信息已更新，我重新算了一下：当前状态评分 ' + ev.score + ' 分（' + ev.level + '）。去「训练推荐」和「饮食推荐」看看新方案吧。');
    }, 700);
  }
  function onBodyLogged() {
    setTimeout(function () {
      say('⚖️', '身体数据记下来了。建议每周固定同一时间（晨起空腹）称重，看趋势比看单次数字靠谱得多。');
    }, 700);
  }
  function onImported(n) {
    setTimeout(function () {
      say('📥', '已经帮你导入 ' + n + ' 条跑步记录，跑量、配速、评估和推荐我都重新算过了。');
    }, 600);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (started) return;
    started = true;

    var svg = document.getElementById('assistantSvg');
    if (svg) svg.innerHTML = svgMarkup();

    loadChat();
    renderChat();
    renderQuick();

    var body = $('#assistantBody');
    var panel = $('#assistantPanel');

    body.addEventListener('click', function () {
      hideBubble();
      var open = panel.classList.toggle('show');
      if (open) {
        renderChat();
        renderQuick();
        setTimeout(function () { var i = $('#chatInput'); if (i) i.focus(); }, 120);
      }
    });
    $('#panelClose').addEventListener('click', function () { panel.classList.remove('show'); });
    $('#bubbleClose').addEventListener('click', function (e) { e.stopPropagation(); hideBubble(); });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#assistant')) panel.classList.remove('show');
    });

    $('#chatForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#chatInput');
      ask(input.value);
      input.value = '';
    });

    $('#chatQuick').addEventListener('click', function (e) {
      var b = e.target.closest('.chat-chip');
      if (b) ask(b.dataset.q);
    });

    $('#chatClear').addEventListener('click', function () {
      log = [];
      saveChat();
      renderChat();
      renderQuick();
      if (window.toast) window.toast('对话已清空');
    });

    // 打招呼
    setTimeout(function () {
      var g = greeting();
      lastText = g.text;
      addMsg('bot', g.ico, g.text);
      if (!panelOpen()) showBubble(g.ico, g.text);
    }, 1200);

    // 预取天气
    fetchWeather(function (w) { weather = w; });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) clearTimeout(timer);
      else scheduleNext(true);
    });

    scheduleNext(true);
  }

  return {
    init: init,
    onRunLogged: onRunLogged,
    onCheckin: onCheckin,
    onGoalSaved: onGoalSaved,
    onProfileSaved: onProfileSaved,
    onBodyLogged: onBodyLogged,
    onImported: onImported,
    ask: ask,
    show: say,
    // 调试 / 自测用
    _fetchWeather: fetchWeather,
    _weatherAdvice: weatherAdvice,
    _weatherLine: weatherLine,
    _current: function () { return weather; },
    _log: function () { return log; },
    _renderChat: renderChat
  };
})();

window.Assistant = Assistant;

/* 把天气能力注入问答引擎，避免循环依赖 */
if (window.Chat) Chat.setWeatherProvider(Assistant._fetchWeather);
