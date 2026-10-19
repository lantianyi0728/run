/* ============================================================
   llm.js — WorkBuddy 云服务里的大模型（免密钥）
   ------------------------------------------------------------
   设计原则：
   · 算数 100% 在本地完成，模型只负责「把算好的结论说成人话」。
     模型永远拿不到机会去编造一个数字。
   · 任何一步失败（CDN 打不开 / 域名不匹配 / 超额 / 断网），
     自动降级到本地模板，用户端无感，功能不残。
   · 前端只拿 publicConfig 里的 endpoint + publishableKey，
     没有任何长期密钥。
   ============================================================ */

var LLM = (function () {

  var CFG = {
    endpoint: 'https://runmate-61270.app.workbuddy.host',
    publishableKey: 'wbpk_G9DqoLudJjD0FGCSOV375M_kmiK17232lzpmup6ssJDHD3oJO3rnDcj'
  };
  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';

  var STATE = 'idle';      // idle | loading | ready | off
  var client = null;
  var model = null;
  var waiters = [];
  var reason = '';

  var MIN_GAP = 1400;      // 两次调用之间至少隔 1.4s，防止连点刷额度
  var MAX_CALLS = 60;      // 单次会话最多 60 次，超额自动转本地
  var calls = 0;
  var lastAt = 0;
  var queue = Promise.resolve();

  function log() {
    try { console.log.apply(console, ['[LLM]'].concat([].slice.call(arguments))); } catch (e) { }
  }

  function settle(ok, why) {
    STATE = ok ? 'ready' : 'off';
    if (why) reason = why;
    var w = waiters;
    waiters = [];
    w.forEach(function (fn) { try { fn(ok); } catch (e) { } });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud) { resolve(); return; }
      var done = false;
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { if (!done) { done = true; resolve(); } };
      s.onerror = function () { if (!done) { done = true; reject(new Error('sdk_load_failed')); } };
      document.head.appendChild(s);
      setTimeout(function () {
        if (done) return;
        if (window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud) { done = true; resolve(); return; }
        done = true;
        reject(new Error('sdk_timeout'));
      }, 7000);
    });
  }

  function pickModel(models) {
    if (!models || !models.length) return null;
    var usable = models.filter(function (m) { return m && m.disabled !== true; });
    if (!usable.length) return null;
    var prefer = ['flash', 'lite', 'mini', 'turbo', 'fast', 'chat'];
    for (var i = 0; i < prefer.length; i++) {
      for (var j = 0; j < usable.length; j++) {
        var id = String(usable[j].id || '').toLowerCase();
        if (id.indexOf(prefer[i]) >= 0) return usable[j];
      }
    }
    return usable[0];
  }

  function ensure(cb) {
    if (STATE === 'ready') { cb(true); return; }
    if (STATE === 'off') { cb(false); return; }
    waiters.push(cb);
    if (STATE === 'loading') return;
    STATE = 'loading';

    // file:// 打开时浏览器会带 Origin: null，云服务按域名精确匹配，必然拒绝。
    // 直接走本地大脑，别浪费一次请求。
    var isFile = location.protocol === 'file:';
    if (isFile) { settle(false, 'file:// 打开，本地模式下不联网'); return; }

    loadScript(SDK_URL)
      .then(function () {
        var C = window.WorkBuddyCloud;
        if (!C || typeof C.createWorkBuddyCloud !== 'function') throw new Error('sdk_missing');
        client = C.createWorkBuddyCloud({
          endpoint: CFG.endpoint,
          publishableKey: CFG.publishableKey
        });
        return client.llm.models.list();
      })
      .then(function (models) {
        var m = pickModel(models);
        if (!m) { settle(false, '没有可用模型'); return; }
        model = m;
        log('model =', m.id, m.name || '');
        settle(true);
      })
      .catch(function (e) {
        log('init failed:', e && (e.message || e));
        settle(false, (e && e.message) || 'init_failed');
      });
  }

  /* 把 SSE 流收成完整字符串（SDK 只支持流式，没有非流式返回） */
  function collect(params) {
    return new Promise(function (resolve, reject) {
      var stream;
      try { stream = client.llm.chat.completions.create(params); }
      catch (e) { reject(e); return; }

      var it = stream && stream[Symbol.asyncIterator] ? stream[Symbol.asyncIterator]() : null;
      if (!it) { reject(new Error('no_async_iterator')); return; }

      var text = '';
      function step() {
        it.next().then(function (r) {
          if (r.done) { resolve(text); return; }
          var chunk = r.value;
          var delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
          if (delta && delta.content) text += delta.content;
          step();
        }).catch(reject);
      }
      step();
    });
  }

  /**
   * chat(system, user, options, cb)
   * options: { json: bool, temperature: number }
   * cb(ok, text|errorMessage)
   */
  function chat(system, user, options, cb) {
    options = options || {};
    ensure(function (ok) {
      if (!ok) { cb(false, 'local'); return; }
      if (calls >= MAX_CALLS) { cb(false, 'quota_guard'); return; }

      var wait = Math.max(0, MIN_GAP - (Date.now() - lastAt));
      var run = function () {
        lastAt = Date.now();
        calls++;
        var params = {
          model: model.id,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          stream: true,
          stream_options: { include_usage: true },
          temperature: typeof options.temperature === 'number' ? options.temperature : 0.75
        };
        if (options.json) params.response_format = { type: 'json_object' };

        collect(params).then(function (text) {
          if (!text) { cb(false, 'empty'); return; }
          cb(true, text);
        }).catch(function (e) {
          var code = e && e.error && e.error.code ? e.error.code : '';
          log('call failed:', code || (e && e.message));
          // 额度类 / 认证类错误之后就别再试了，省得每次提问都卡一下
          if (/^auth_/.test(code) || /^quota_/.test(code) || /^request_/.test(code)) {
            STATE = 'off';
            reason = code;
          }
          cb(false, code || 'call_failed');
        });
      };

      queue = queue.then(function () {
        return new Promise(function (res) {
          setTimeout(function () { run(); res(); }, wait);
        });
      });
    });
  }

  function parseJSON(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  return {
    ensure: ensure,
    chat: chat,
    parseJSON: parseJSON,
    status: function () {
      return { state: STATE, model: model ? (model.name || model.id) : null, calls: calls, reason: reason };
    },
    isReady: function () { return STATE === 'ready'; },
    _pickModel: pickModel,
    _reset: function () { STATE = 'idle'; client = null; model = null; calls = 0; reason = ''; }
  };
})();

if (typeof window !== 'undefined') window.LLM = LLM;
