/* ============================================================
   assistant.js — 悬浮的"双人搭档"：陈教 + 小跑
   ------------------------------------------------------------
   行为：
   · 打开网页 → 两人各说一句，把分工交代清楚（不是一个人自说自话）
   · 你提问 → 会诊：陈教先给判断，小跑接着补人话（顺序按话题自动切换）
   · 你记录跑步 / 打卡 / 改目标 → 陈教在后台静默分析，
     值得说的才让小跑转述，避免两个人轮流骚扰你
   · 每 3-4 分钟偶尔来一段两人的短对话（有话才说，不硬凑）
   · 面板顶部可以切「会诊 / 只问陈教 / 只问小跑」
   ============================================================ */

var Assistant = (function () {

  var TICK_MIN = 200000;
  var TICK_MAX = 260000;
  var FIRST_DELAY_MIN = 70000;
  var FIRST_DELAY_MAX = 100000;
  var HIDE_MIN = 7000;
  var HIDE_MAX = 15000;
  var CHAT_MAX = 60;

  var timer = null, hideTimer = null, started = false, typing = false;
  var lastText = '';
  var weather = null;
  var log = [];            // [{role:'bot'|'me', who, ico, name, text, ts}]

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function timeStr(ts) {
    var d = new Date(ts);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }
  function rand(a, b) { return a + Math.floor(Math.random() * (b - a)); }

  /* ================= Q 版角色 ================= */

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

  function coachSvgMarkup() {
    return ''
      + '<defs>'
      + '<radialGradient id="acBody" cx="36%" cy="26%" r="82%">'
      + '<stop offset="0%" stop-color="#f6faff"/>'
      + '<stop offset="52%" stop-color="#dbe8fb"/>'
      + '<stop offset="100%" stop-color="#a3c0e9"/>'
      + '</radialGradient>'
      + '<linearGradient id="acCap" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0%" stop-color="#5b8ce0"/><stop offset="100%" stop-color="#2d54a8"/>'
      + '</linearGradient>'
      + '<radialGradient id="acShine" cx="50%" cy="50%" r="50%">'
      + '<stop offset="0%" stop-color="#ffffff" stop-opacity=".9"/>'
      + '<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>'
      + '</radialGradient>'
      + '</defs>'
      + '<circle cx="60" cy="60" r="58" fill="url(#acBody)"/>'
      + '<ellipse cx="42" cy="32" rx="19" ry="13" fill="url(#acShine)"/>'
      + '<path d="M17 45 Q25 11 60 11 Q95 11 103 45 Q60 33 17 45 Z" fill="url(#acCap)"/>'
      + '<path d="M17 45 Q60 33 103 45 Q60 53 17 45 Z" fill="#26427c" opacity=".5"/>'
      + '<circle cx="60" cy="13.5" r="3.2" fill="#93b7ec"/>'
      + '<g fill="none" stroke="#2b3445" stroke-width="2.5">'
      + '<rect x="32" y="53" width="25" height="20" rx="8"/>'
      + '<rect x="63" y="53" width="25" height="20" rx="8"/>'
      + '<path d="M57 61.5 h6"/>'
      + '</g>'
      + '<ellipse cx="44.5" cy="63" rx="4.4" ry="5.4" fill="#2b3445"/>'
      + '<ellipse cx="75.5" cy="63" rx="4.4" ry="5.4" fill="#2b3445"/>'
      + '<circle cx="43" cy="61.2" r="1.6" fill="#fff"/>'
      + '<circle cx="74" cy="61.2" r="1.6" fill="#fff"/>'
      + '<path d="M51 85 h18" stroke="#2b3445" stroke-width="2.8" stroke-linecap="round"/>'
      + '<g transform="translate(94,70)">'
      + '<rect x="0" y="0" width="12" height="9" rx="3.5" fill="#ffb340"/>'
      + '<circle cx="4" cy="4.5" r="1.7" fill="#8a5a00"/>'
      + '</g>';
  }

  /* ================= 天气 ================= */

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
        } else { throw new Error('bad'); }
      })
      .catch(function () { clearTimeout(timeout); finish(fallback); });
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

  /* ================= 主动消息池 ================= */

  function dynamicMessages() {
    var pool = [];
    var today = Store.today();
    var runs = Store.getRuns();
    var d = AgentBus.data();

    if (weather) pool.push({ ico: weather.emoji, text: weatherLine(weather) + weatherAdvice(weather) });

    if (!Store.isChecked(today) && new Date().getHours() >= 17) {
      pool.push({ ico: '⏰', text: '今天还没打卡哦，睡前花 2 秒打个卡吧，别断了记录～' });
    }

    if (runs.length) {
      if (d.gapDays >= 4) {
        pool.push({ ico: '🐢', text: '已经 ' + d.gapDays + ' 天没跑步记录了，状态是会掉的。今天先从 20 分钟轻松跑开始找找感觉？' });
      } else if (d.gapDays <= 1) {
        pool.push({ ico: '📈', text: '最近一次是 ' + d.lastRun.date + ' 的 ' + d.lastRun.distance + ' km，节奏保持得不错。' });
      }
    } else {
      pool.push({ ico: '🚶', text: '还没有跑步记录呢。第一次不用多，20 分钟慢跑就足够开启这一切了。' });
    }

    if (d.volume.recommend > d.volume.current && d.volume.current > 0) {
      pool.push({ ico: '📊', text: '目前周均 ' + d.volume.current + ' km，目标区间是 ' + d.volume.recommend + ' km，慢慢往上加就行，别急。' });
    }

    var tips = Coach.tips(Store.getProfile(), Calc.evaluateBody(Store.getProfile(), runs, Store.getCheckins()), runs);
    var idx = (new Date().getDate() + new Date().getHours()) % tips.length;
    pool.push({ ico: '💡', text: tips[idx] });
    pool.push({ ico: '💡', text: tips[(idx + 5) % tips.length] });

    var enc = Coach.encouragements();
    pool.push({ ico: '✨', text: enc[(new Date().getMinutes() + new Date().getDate()) % enc.length] });
    pool.push({ ico: '💬', text: '有问题随时问我们俩，比如「我该怎么练」「今天适合跑步吗」。' });

    return pool;
  }

  /* ================= 渲染 ================= */

  function panelOpen() {
    var p = $('#assistantPanel');
    return !!(p && p.classList.contains('show'));
  }

  /* 当前在哪个 tab —— 主对话页就是助手的"全屏展开态" */
  function currentTab() {
    var v = document.querySelector('.view.active');
    return v ? v.id.replace(/^view-/, '') : 'dash';
  }
  function isAgentView() { return currentTab() === 'agent'; }

  /* 对话内容此刻是否已经"看得见"（小面板打开 或 就在主对话页） */
  function chatVisible() { return panelOpen() || isAgentView(); }

  function scrollLog(sel) {
    var el = $(sel);
    if (!el) return;
    // scroll-behavior:smooth 会让赋值变成动画，连续渲染时会停在中间，
    // 这里临时切回 auto，保证每次都真的滚到底
    var prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = el.scrollHeight;
    el.style.scrollBehavior = prev;
  }

  function whoClass(who) { return who === 'buddy' ? 'who-buddy' : 'who-coach'; }
  function whoName(who) {
    if (who === 'buddy') return '小跑 · 搭子';
    if (who === 'coach') return '陈教 · 教练';
    return '';
  }

  function emptyHtml(big) {
    if (big) {
      return '<div class="chat-empty">这里坐着两个人 👇<br>' +
        '<b>陈教</b> 负责算你的训练，<b>小跑</b> 负责陪你别放弃。<br>' +
        '直接打字问就行，也可以点左边的「可以这样问」。</div>';
    }
    return '<div class="chat-empty">嗨，我是小跑 👋<br>可以直接打字问我，比如<br>' +
      '「这周跑了多少」「我该怎么练」</div>';
  }

  function logHtml() {
    return log.map(function (m) {
      if (m.role === 'me') {
        return '<div class="chat-row me">' +
          '<div class="chat-avatar">🙂</div>' +
          '<div class="chat-main"><div class="chat-bubble">' + esc(m.text) + '</div>' +
          '<div class="chat-time" style="text-align:right">' + timeStr(m.ts) + '</div></div></div>';
      }
      var who = m.who === 'buddy' ? 'buddy' : 'coach';
      return '<div class="chat-row ' + whoClass(who) + '">' +
        '<div class="chat-avatar ' + who + '">' + (m.ico || '💬') + '</div>' +
        '<div class="chat-main"><div class="chat-name ' + who + '">' + (m.name ? esc(m.name) : whoName(who)) + '</div>' +
        '<div class="chat-bubble">' + esc(m.text) + '</div>' +
        '<div class="chat-time">' + timeStr(m.ts) + '</div></div></div>';
    }).join('');
  }

  function typingHtml() {
    return '<div class="chat-row who-coach typing-row">' +
      '<div class="chat-avatar coach">🧑‍🏫</div>' +
      '<div class="chat-main"><div class="chat-name coach">两人正在会诊</div>' +
      '<div class="chat-bubble typing"><i></i><i></i><i></i></div></div></div>';
  }

  function renderChat() {
    [['#chatLog', false], ['#agentLog', true]].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      if (!log.length) { el.innerHTML = emptyHtml(pair[1]); return; }
      el.innerHTML = logHtml() + (typing ? typingHtml() : '');
    });
    scrollLog('#chatLog');
    scrollLog('#agentLog');
  }

  function quickList() {
    var list = Chat.suggestions().slice(0, 3);
    var mode = Agents.getMode();
    if (mode === 'buddy') {
      list = ['我最近有点跑不动', '怎么才能坚持', '今天不想跑怎么办'];
    } else if (mode === 'coach') {
      list = Chat.suggestions().slice(0, 4);
    } else {
      list.push('你能做什么');
    }
    return list;
  }

  function renderQuick() {
    var html = quickList().map(function (q) {
      return '<button class="chat-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');
    ['#chatQuick', '#agentQuick'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.innerHTML = html;
    });
  }

  function renderRoster() {
    var m = Agents.getMode();
    ['#panelRoster', '#agentRoster'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      [].forEach.call(el.querySelectorAll('.roster-chip'), function (b) {
        b.classList.toggle('active', b.dataset.mode === m);
      });
    });
  }

  function saveChat() {
    try { Store.setUI('chatLog', log.slice(-CHAT_MAX)); } catch (e) { }
  }
  function loadChat() {
    var saved = Store.getUI().chatLog;
    if (Array.isArray(saved)) {
      log = saved.slice(-CHAT_MAX).map(function (m) {
        return { role: m.role, who: m.who || 'buddy', ico: m.ico, name: m.name, text: m.text, ts: m.ts };
      });
    }
  }

  function push(m, noBubble) {
    log.push(m);
    if (log.length > CHAT_MAX) log = log.slice(-CHAT_MAX);
    saveChat();
    renderChat();
    if (!noBubble && m.role === 'bot') {
      renderQuick();
      if (!chatVisible()) showDialog([m]);
    }
  }

  function addMsg(role, ico, text, noBubble, who, name) {
    push({
      role: role, who: who || 'buddy', ico: ico,
      name: name || (role === 'bot' ? whoName(who) : ''),
      text: text, ts: Date.now()
    }, noBubble);
  }

  /* 主动说一句（单声部） */
  function say(ico, text, who) {
    if (!text || text === lastText) return;
    lastText = text;
    addMsg('bot', ico, text, false, who || 'buddy');
  }

  /* 主动说一段双人对话 */
  function sayPair(msgs) {
    if (!msgs || !msgs.length) return;
    lastText = msgs[msgs.length - 1].text;
    msgs.forEach(function (m, i) {
      var item = {
        role: 'bot', who: m.who, ico: m.ico, name: m.name,
        text: m.text, ts: Date.now()
      };
      log.push(item);
      if (log.length > CHAT_MAX) log = log.slice(-CHAT_MAX);
    });
    saveChat();
    renderChat();
    if (!chatVisible()) showDialog(msgs);
    renderQuick();
  }

  /* 气泡：支持一段 / 两段 */
  function showDialog(msgs) {
    var bubble = $('#assistantBubble');
    var box = $('#bubbleText');
    if (!bubble || !box) return;
    box.innerHTML = msgs.map(function (m) {
      var who = m.who === 'buddy' ? 'buddy' : 'coach';
      var label = m.name || whoName(who);
      return '<div class="bub-line ' + who + '">' +
        '<b class="bub-who">' + esc(label) + '</b>' +
        '<span>' + esc(m.text) + '</span></div>';
    }).join('');
    bubble.classList.add('show');
    var total = msgs.reduce(function (a, m) { return a + (m.text || '').length; }, 0);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { bubble.classList.remove('show'); },
      Math.min(HIDE_MAX, Math.max(HIDE_MIN, HIDE_MIN + total * 60)));
  }

  /* 兼容旧签名 showBubble(ico, text) */
  function showBubble(ico, text) {
    showDialog([{ who: 'buddy', ico: ico, name: '小跑 · 搭子', text: text }]);
  }

  function hideBubble() {
    var b = $('#assistantBubble');
    if (b) b.classList.remove('show');
  }

  /* ================= 提问：会诊 ================= */

  function ask(question) {
    var q = String(question || '').trim();
    if (!q) return;
    addMsg('me', '', q, true);
    typing = true;
    renderChat();

    var t0 = Date.now();
    Agents.consult(q, function (msgs) {
      var wait = Math.max(0, 420 - (Date.now() - t0));
      setTimeout(function () { reveal(msgs, 0); }, wait);
    });
  }

  function reveal(msgs, i) {
    if (i >= msgs.length) { typing = false; renderChat(); return; }
    typing = false;
    var m = msgs[i];
    lastText = m.text;
    log.push({
      role: 'bot', who: m.who, ico: m.ico,
      name: m.name || whoName(m.who), text: m.text, ts: Date.now()
    });
    if (log.length > CHAT_MAX) log = log.slice(-CHAT_MAX);
    saveChat();

    var more = i < msgs.length - 1;
    typing = more;
    renderChat();

    if (!more) {
      renderQuick();
      if (!chatVisible()) showDialog(msgs);
    } else {
      setTimeout(function () { reveal(msgs, i + 1); }, 460);
    }
  }

  /* ================= 定时节奏 ================= */

  function scheduleNext(first) {
    clearTimeout(timer);
    var delay = first ? rand(FIRST_DELAY_MIN, FIRST_DELAY_MAX) : rand(TICK_MIN, TICK_MAX);
    timer = setTimeout(function () {
      if (document.hidden) { scheduleNext(false); return; }
      fire();
      scheduleNext(false);
    }, delay);
  }

  function fire() {
    // 三成概率来一段两人的短对话 —— 这是"两个智能体在交互"最直观的样子
    if (Math.random() < 0.34) {
      var pair = Agents.banter();
      if (pair && pair.length) {
        sayPair(pair);
        return;
      }
    }
    var pool = dynamicMessages();
    for (var i = 0; i < 5; i++) {
      var m = pool[Math.floor(Math.random() * pool.length)];
      if (!m || m.text === lastText) continue;
      say(m.ico, m.text, 'buddy');
      return;
    }
  }

  /* ================= 后台会诊：数据变了 ================= */

  function runBackstage(kind, payload, delay) {
    setTimeout(function () {
      Agents.backstage(kind, payload, function (msg) {
        if (msg) say(msg.ico, msg.text, 'buddy');
      });
    }, delay || 700);
  }

  function onRunLogged(run) { AgentBus.invalidate(); runBackstage('run', run, 800); }
  function onCheckin(streak) { AgentBus.invalidate(); runBackstage('checkin', streak || Store.currentStreak(), 600); }
  function onGoalSaved() { AgentBus.invalidate(); runBackstage('goal', null, 800); }
  function onProfileSaved() { AgentBus.invalidate(); runBackstage('profile', null, 800); }
  function onBodyLogged() { AgentBus.invalidate(); runBackstage('body', null, 800); }
  function onImported(n) { AgentBus.invalidate(); runBackstage('import', n, 600); }

  /* 任何写操作都可以顺手广播一下，后台会自行决定要不要说话 */
  function broadcast(evt, payload) {
    AgentBus.invalidate();
    AgentBus.emit(evt, payload);
  }

  /* ================= 开场 ================= */

  function opening() {
    var d = AgentBus.data();
    var h = new Date().getHours();
    var when = h < 5 ? '这个点还没睡' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    var name = d.name;

    var coachTxt;
    if (!d.totalRuns) {
      coachTxt = '我是陈教。你还没有一条跑步记录，所以我没法给你任何判断。先跑一次，哪怕 20 分钟，剩下的我来。';
    } else if (d.gapDays >= 5) {
      coachTxt = '我是陈教。你已经 ' + d.gapDays + ' 天没跑了，这个间隔再拖下去，之前攒的有氧底子会开始掉。今天先恢复 20 分钟。';
    } else if (d.body && d.body.score < 60) {
      coachTxt = '我是陈教。你现在身体评分 ' + d.body.score + ' 分，偏低。这两天别冲量，先把睡眠补回来。';
    } else {
      coachTxt = '我是陈教。近 7 天 ' + d.weekKm + ' km，' +
        (d.deltaPct === null ? '刚起头，先跑稳。' :
          d.deltaPct >= 10 ? '在往上走，节奏是对的。' :
            d.deltaPct <= -15 ? '比上周少了，得盯一下。' : '基本持平，保持住。');
    }

    var buddyTxt = when + '，' + name + '。我是小跑，就住在你旁边这一格 —— ' +
      (d.checkedToday ? '今天已经打过卡了，我不催你，陪你聊两句。'
        : d.streak >= 3 ? '你已经连着 ' + d.streak + ' 天了，今天别断在这儿。'
          : '不着急，先跟我说说今天什么状态。');

    return [
      { who: 'coach', ico: '🧑‍🏫', name: '陈教 · 教练', text: coachTxt },
      { who: 'buddy', ico: '🐣', name: '小跑 · 搭子', text: buddyTxt }
    ];
  }

  /* 切 tab 时的联动：主对话页 === 助手全屏展开，别在右下角再摆一个小助手 */
  function onTabChange(name) {
    var box = $('#assistant');
    if (box) box.classList.toggle('is-hidden', name === 'agent');

    if (name === 'agent') {
      var p = $('#assistantPanel');
      if (p) p.classList.remove('show');
      hideBubble();
      renderChat();
      renderQuick();
      renderRoster();
    }
  }

  /* ================= 初始化 ================= */

  function init() {
    if (started) return;
    started = true;

    Agents.hydrate();

    var svg = document.getElementById('assistantSvg');
    if (svg) svg.innerHTML = svgMarkup();
    var csvg = document.getElementById('coachSvg');
    if (csvg) csvg.innerHTML = coachSvgMarkup();

    loadChat();
    renderChat();
    renderQuick();
    renderRoster();

    var body = $('#assistantBody');
    var coachHead = $('#assistantCoachHead');
    var panel = $('#assistantPanel');

    function closePanel() { if (panel) panel.classList.remove('show'); }

    function togglePanel() {
      hideBubble();
      var open = panel.classList.toggle('show');
      if (open) {
        renderChat();
        renderQuick();
        renderRoster();
        setTimeout(function () { var i = $('#chatInput'); if (i) i.focus(); }, 120);
      }
    }

    if (body) body.addEventListener('click', togglePanel);
    if (coachHead) coachHead.addEventListener('click', togglePanel);
    $('#panelClose').addEventListener('click', closePanel);
    $('#bubbleClose').addEventListener('click', function (e) { e.stopPropagation(); hideBubble(); });

    // 小面板里的「回到主对话」：切回智能教练搭子，并收起小面板
    var toMain = $('#panelToMain');
    if (toMain) {
      toMain.addEventListener('click', function (e) {
        e.stopPropagation();
        closePanel();
        hideBubble();
        if (window.App) window.App.switchTab('agent');
      });
    }

    document.addEventListener('click', function (e) {
      if (!e.target.closest('#assistant')) closePanel();
    });

    // 两个输入框（大页 / 小面板）走同一条提问链路
    [['#chatForm', '#chatInput'], ['#agentForm', '#agentInput']].forEach(function (pair) {
      var form = $(pair[0]);
      if (!form) return;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = $(pair[1]);
        if (!input) return;
        ask(input.value);
        input.value = '';
      });
    });

    // 快捷问题 / 左侧示例问题 / 模式切换 —— 用事件委托，两个容器共用
    document.addEventListener('click', function (e) {
      var chip = e.target.closest('.chat-chip');
      if (chip && chip.dataset.q) { ask(chip.dataset.q); return; }

      var tip = e.target.closest('.ag-tip');
      if (tip && tip.dataset.q) { ask(tip.dataset.q); return; }

      var rc = e.target.closest('.roster-chip');
      if (rc && rc.dataset.mode) {
        Agents.setMode(rc.dataset.mode);
        renderRoster();
        renderQuick();
      }
    });

    [['#chatClear'], ['#agentClear']].forEach(function (pair) {
      var btn = $(pair[0]);
      if (!btn) return;
      btn.addEventListener('click', function () {
        log = [];
        saveChat();
        renderChat();
        renderQuick();
        if (window.toast) window.toast('对话已清空');
      });
    });

    // 开场：两人各一句（同一天只打一次招呼，避免每次刷新刷屏）
    setTimeout(function () {
      var today = Store.today();
      var ui = Store.getUI();
      if (ui.greetedOn === today) { renderChat(); renderQuick(); return; }

      var pair = opening();
      lastText = pair[pair.length - 1].text;
      pair.forEach(function (m) {
        log.push({ role: 'bot', who: m.who, ico: m.ico, name: m.name, text: m.text, ts: Date.now() });
      });
      if (log.length > CHAT_MAX) log = log.slice(-CHAT_MAX);
      saveChat();
      Store.setUI('greetedOn', today);
      renderChat();
      renderQuick();
      if (!chatVisible()) showDialog(pair);
    }, 1300);

    fetchWeather(function (w) { weather = w; });
    LLM.ensure(function () { /* 静默预热：成功了以后提问就是大模型在组织语言 */ });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) clearTimeout(timer);
      else scheduleNext(true);
    });

    // 数据变了 → 广播 + 作废快照，保证两人看到的是最新数字
    AgentBus.on('data:changed', function () { AgentBus.invalidate(); });

    // 初始化时按当前 tab 摆好助手的位置：主对话页就藏起悬浮助手
    onTabChange(currentTab());

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
    broadcast: broadcast,
    ask: ask,
    show: say,
    onTabChange: onTabChange,
    isAgentView: isAgentView,
    _fetchWeather: fetchWeather,
    _weatherAdvice: weatherAdvice,
    _weatherLine: weatherLine,
    _current: function () { return weather; },
    _log: function () { return log; },
    _renderChat: renderChat,
    _opening: opening,
    _reveal: reveal,
    _currentTab: currentTab,
    _chatVisible: chatVisible
  };
})();

window.Assistant = Assistant;

/* 把天气能力注入问答引擎，避免循环依赖 */
if (window.Chat) Chat.setWeatherProvider(Assistant._fetchWeather);
