/* ============================================================
   importer.js — 运动数据导入
   支持：
     1) 粘贴 Keep 等 App 的「分享文案」→ 智能解析
     2) 导入运动数据文件：.gpx / .tcx / .csv / .tsv / .json / .txt
   全部在浏览器本地完成，不上传任何数据。

   说明：Keep 没有对外开放 API，所以无法做到"扫码授权一键同步"。
   这里的做法是把你从 Keep 分享/导出出来的数据解析成本站的跑步记录。
   ============================================================ */

var Importer = (function () {

  var TYPE_LABEL = { easy: '轻松跑', tempo: '节奏跑', interval: '间歇跑', long: '长距离', race: '比赛/测试', recovery: '恢复跑' };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) {
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function clampDate(y, m, d) {
    var dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  /* ---------------- 通用工具 ---------------- */
  function guessType(text) {
    if (/长距离|lsd|长跑|耐力跑/i.test(text)) return 'long';
    if (/间歇|变速|冲刺|重复跑|interva/i.test(text)) return 'interval';
    if (/节奏|阈値|阈值|tempo|乳酸/i.test(text)) return 'tempo';
    if (/恢复|放松跑|recovery/i.test(text)) return 'recovery';
    if (/比赛|马拉松|半马|全马|测试赛|race/i.test(text)) return 'race';
    return 'easy';
  }

  function norm(run) {
    if (!run.date) run.date = Store.today();
    run.distance = Math.round(run.distance * 100) / 100;
    run.seconds = Math.round(run.seconds);
    run.type = run.type || 'easy';
    if (!run.note) run.note = '';
    return run;
  }

  function valid(run) {
    return run && run.distance > 0.05 && run.seconds > 20 &&
      run.distance < 500 && run.seconds / run.distance < 2400; // 配速快于 40 分钟/公里视为异常
  }

  /* ---------------- 1. 分享文本解析 ---------------- */
  /**
   * 从一段自然语言里抠出跑步数据。
   * 兼容 Keep / 悦跑圈 / 咕咚 等常见分享文案，例如：
   *   我刚用 Keep 跑了 5.00 公里，用时 26 分 30 秒，平均配速 5'18"
   *   #KeepRunning 10.02km | 55:12 | 5'30"/km | 心率 152
   */
  function parseLine(block) {
    var text = String(block).trim();
    if (!text) return null;

    var run = {};

    /* 距离 */
    var m = text.match(/(\d+(?:\.\d+)?)\s*(?:公里|千米|km|KM|Km|kM)/);
    if (m) run.distance = parseFloat(m[1]);
    else {
      m = text.match(/(\d{3,6})\s*米/);
      if (m) run.distance = parseFloat(m[1]) / 1000;
    }
    if (!run.distance) return null;

    /* 配速（必须带"配速"字样，避免和时长混淆） */
    var paceSec = null;
    m = text.match(/配速[^\d]{0,4}(\d{1,2})\s*['′’:\uff1a]\s*(\d{1,2})/);
    if (m) paceSec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    else {
      // 形如 5'30"/km 且位置靠近 km
      m = text.match(/(\d{1,2})\s*['′’]\s*(\d{1,2})\s*["″]?\s*\/?\s*(?:km|公里)/i);
      if (m) paceSec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }

    /* 时长 */
    var seconds = null;
    // 1小时23分45秒
    m = text.match(/(\d+)\s*(?:小时|时|h)\s*(\d+)\s*(?:分|分钟|min|m)?(?:\s*(\d+)\s*(?:秒|s))?/i);
    if (m) seconds = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0);
    if (seconds === null) {
      // 26分30秒
      m = text.match(/(\d+)\s*(?:分|分钟|min|m)\s*(\d+)\s*(?:秒|s)/i);
      if (m) seconds = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
    if (seconds === null) {
      // 用时 1:23:45 / 26:30
      m = text.match(/(?:用时|时间|时长|耗时|花了)[^\d]{0,4}(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        seconds = m[3]
          ? parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)
          : parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      }
    }
    if (seconds === null) {
      // 无前缀的 hh:mm:ss（不会和配速混淆）
      m = text.match(/(?:^|[^\d])(\d{1,2}):(\d{2}):(\d{2})(?![\d])/);
      if (m) seconds = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    }
    if (seconds === null) {
      // 分享格式里的 "| 42:15 |" 这种竖线分隔的时长
      m = text.match(/[|｜]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[|｜]/);
      if (m) {
        seconds = m[3]
          ? parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)
          : parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      }
    }
    if (seconds === null) {
      // 裸的 26分 或 55 分钟
      m = text.match(/(\d+)\s*(?:分钟|分)(?!\d)/);
      if (m && /用时|时间|时长|耗时|花了|分钟/i.test(text)) seconds = parseInt(m[1], 10) * 60;
    }
    if (seconds === null && paceSec) seconds = paceSec * run.distance;
    if (!seconds) return null;
    run.seconds = seconds;

    /* 心率 */
    m = text.match(/(?:平均)?心率[^\d]{0,4}(\d{2,3})/);
    if (m) run.hr = parseInt(m[1], 10);
    else {
      m = text.match(/(\d{2,3})\s*(?:bpm|次\/分|次每分钟)/i);
      if (m) run.hr = parseInt(m[1], 10);
    }

    /* 日期 */
    m = text.match(/(\d{4})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/);
    if (m) {
      var dt = clampDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
      if (dt) run.date = toDateStr(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    } else {
      m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (m) {
        var dt2 = clampDate(new Date().getFullYear(), parseInt(m[1], 10), parseInt(m[2], 10));
        if (dt2) run.date = toDateStr(dt2.getFullYear(), dt2.getMonth() + 1, dt2.getDate());
      } else if (/今天/.test(text)) run.date = Store.today();
      else if (/昨天/.test(text)) run.date = Store.addDays(Store.today(), -1);
      else if (/前天/.test(text)) run.date = Store.addDays(Store.today(), -2);
    }

    /* 类型与备注 */
    run.type = guessType(text);
    var note = text
      .replace(/\s+/g, ' ')
      .replace(/^[#\-\s]*(?:keep|悦跑圈|咕咚|华为运动健康|小米运动)[^\s]*/i, '')
      .trim();
    if (note.length > 40) note = note.slice(0, 40) + '…';
    run.note = '从分享文本导入' + (note ? '：' + note : '');

    return norm(run);
  }

  function parseText(text) {
    var blocks = String(text).split(/\n\s*\n|\n(?=\s*[#\-*•\d])/);
    var runs = [], failed = [];
    blocks.forEach(function (b) {
      var t = b.trim();
      if (!t) return;
      // 一段里可能有多行，逐行再试一次
      if (/公里|千米|km/i.test(t)) {
        var r = parseLine(t.replace(/\n/g, ' '));
        if (r && valid(r)) runs.push(r);
        else failed.push(t.slice(0, 60));
      }
    });
    if (!runs.length) {
      // 整体再试一次
      var r2 = parseLine(String(text).replace(/\n/g, ' '));
      if (r2 && valid(r2)) runs.push(r2);
    }
    return { runs: runs, failed: failed };
  }

  /* ---------------- 2. GPX ---------------- */
  function haversine(aLat, aLon, bLat, bLon) {
    var R = 6371000;
    var dLat = (bLat - aLat) * Math.PI / 180;
    var dLon = (bLon - aLon) * Math.PI / 180;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function parseGPX(xml) {
    var runs = [];
    var trkRe = /<trk\b[\s\S]*?<\/trk>/gi;
    var trks = xml.match(trkRe) || [xml];

    trks.forEach(function (trk) {
      var pts = [];
      var ptRe = /<trkpt\b[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;
      var m;
      while ((m = ptRe.exec(trk))) {
        var t = m[3].match(/<time>([^<]+)<\/time>/i);
        var hr = m[3].match(/<gpxtpx:hr>(\d+)<\/gpxtpx:hr>/i) || m[3].match(/<hr>(\d+)<\/hr>/i);
        pts.push({
          lat: parseFloat(m[1]), lon: parseFloat(m[2]),
          time: t ? new Date(t[1]).getTime() : null,
          hr: hr ? parseInt(hr[1], 10) : null
        });
      }
      if (pts.length < 2) return;

      var dist = 0;
      for (var i = 1; i < pts.length; i++) {
        dist += haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
      }
      var km = dist / 1000;
      if (km < 0.05) return;

      var times = pts.map(function (p) { return p.time; }).filter(function (t) { return t; });
      var seconds = null;
      if (times.length >= 2) seconds = (times[times.length - 1] - times[0]) / 1000;
      if (!seconds || seconds < 20) return;

      var hrs = pts.map(function (p) { return p.hr; }).filter(function (h) { return h; });
      var date = times.length ? Store.dateStr(new Date(times[0])) : Store.today();

      var nameM = trk.match(/<name>([^<]+)<\/name>/i);
      runs.push(norm({
        date: date, distance: km, seconds: seconds,
        hr: hrs.length ? Math.round(hrs.reduce(function (a, b) { return a + b; }, 0) / hrs.length) : null,
        type: guessType((nameM ? nameM[1] : '') + ' ' + xml.slice(0, 400)),
        note: '从 GPX 文件导入' + (nameM ? '：' + nameM[1] : '')
      }));
    });
    return { runs: runs.filter(valid), failed: [] };
  }

  /* ---------------- 3. TCX ---------------- */
  function parseTCX(xml) {
    var runs = [];
    var actRe = /<Activity\b([^>]*)>([\s\S]*?)<\/Activity>/gi;
    var m;
    while ((m = actRe.exec(xml))) {
      var attrs = m[1], body = m[2];
      var st = attrs.match(/StartTime="([^"]+)"/i);
      var laps = body.match(/<Lap\b[\s\S]*?<\/Lap>/gi) || [body];

      var totalSec = 0, totalM = 0, hrSum = 0, hrN = 0;
      laps.forEach(function (lap) {
        var ts = lap.match(/<TotalTimeSeconds>([\d.]+)<\/TotalTimeSeconds>/i);
        var ds = lap.match(/<DistanceMeters>([\d.]+)<\/DistanceMeters>/i);
        var hr = lap.match(/<AverageHeartRateBpm[^>]*>\s*<Value>(\d+)<\/Value>/i);
        if (ts) totalSec += parseFloat(ts[1]);
        if (ds) totalM += parseFloat(ds[1]);
        if (hr) { hrSum += parseInt(hr[1], 10); hrN++; }
      });
      if (totalM < 50 || totalSec < 20) continue;

      var date = st ? Store.dateStr(new Date(st[1])) : Store.today();
      var sport = (attrs.match(/Sport="([^"]+)"/i) || [])[1] || '';
      // 只取跑步类，其他运动跳过
      if (sport && !/running|walking/i.test(sport) && !/biking/i.test(sport)) { /* 保留，仅标注 */ }

      runs.push(norm({
        date: date, distance: totalM / 1000, seconds: totalSec,
        hr: hrN ? Math.round(hrSum / hrN) : null,
        type: guessType(sport),
        note: '从 TCX 文件导入' + (sport ? '（' + sport + '）' : '')
      }));
    }
    return { runs: runs.filter(valid), failed: [] };
  }

  /* ---------------- 4. CSV / TSV ---------------- */
  function parseCSV(text) {
    var lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return { runs: [], failed: ['表格至少需要表头和一行数据'] };

    var delim = (lines[0].match(/\t/) ? '\t' : (lines[0].match(/;/) && !lines[0].match(/,/) ? ';' : ','));

    function split(line) {
      var out = [], cur = '', inQ = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (inQ) {
          if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
          else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === delim) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out.map(function (s) { return s.trim(); });
    }

    var head = split(lines[0]).map(function (h) { return h.toLowerCase(); });
    function col() {
      for (var a = 0; a < arguments.length; a++) {
        var names = arguments[a];
        for (var i = 0; i < head.length; i++) {
          if (names.some(function (n) { return head[i].indexOf(n) >= 0; })) return i;
        }
      }
      return -1;
    }
    var cDate = col(['日期', 'date', '开始时间', 'starttime', 'stime', '时间']);
    var cDist = col(['距离', 'distance', 'km', '里程', '公里']);
    var cDur = col(['时长', 'duration', '用时', 'time', '总时间', '运动时间', 'seconds', '秒']);
    var cPace = col(['配速', 'pace', '平均配速']);
    var cHr = col(['心率', 'heartrate', 'hr', '平均心率']);
    var cType = col(['类型', 'type', '运动类型', 'sport']);
    var cNote = col(['备注', 'note', '标题', 'title', '名称']);

    if (cDist < 0 || (cDur < 0 && cPace < 0)) {
      return { runs: [], failed: ['表格里找不到「距离」或「时长/配速」列，请检查表头'] };
    }

    var runs = [], failed = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = split(lines[i]);
      var get = function (idx) { return idx >= 0 && idx < cells.length ? cells[idx] : ''; };

      var dRaw = get(cDist);
      var dm = String(dRaw).match(/([\d.]+)\s*(km|公里|千米|m|米)?/i);
      if (!dm) { failed.push('第 ' + (i + 1) + ' 行：距离无法识别'); continue; }
      var km = parseFloat(dm[1]);
      if (dm[2] && /^(m|米)$/i.test(dm[2])) km = km / 1000;
      if (km > 5000) km = km / 1000; // 大概率单位是米
      if (!(km > 0.05)) { failed.push('第 ' + (i + 1) + ' 行：距离异常'); continue; }

      var sec = null;
      var dRaw2 = get(cDur);
      if (dRaw2) {
        var s = String(dRaw2).trim();
        if (/^\d+(\.\d+)?$/.test(s)) {
          sec = parseFloat(s);
          if (sec > 24 * 3600) sec = sec / 1000;        // 毫秒
        } else {
          var mm;
          if ((mm = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/))) sec = +mm[1] * 3600 + +mm[2] * 60 + +mm[3];
          else if ((mm = s.match(/^(\d+):(\d{1,2})$/))) sec = +mm[1] * 60 + +mm[2];
          else if ((mm = s.match(/(\d+)\s*小时\s*(\d+)\s*分/))) sec = +mm[1] * 3600 + +mm[2] * 60;
          else if ((mm = s.match(/(\d+)\s*分\s*(\d+)\s*秒/))) sec = +mm[1] * 60 + +mm[2];
          else if ((mm = s.match(/(\d+)\s*分钟/))) sec = +mm[1] * 60;
        }
      }
      if (!sec) {
        var pRaw = String(get(cPace)).trim();
        var pm = pRaw.match(/^(\d{1,2})[:'′]\s*(\d{1,2})/);
        if (pm) sec = (+pm[1] * 60 + +pm[2]) * km;
      }
      if (!sec) { failed.push('第 ' + (i + 1) + ' 行：时长/配速无法识别'); continue; }

      var dateStr = null;
      var dr = String(get(cDate)).trim();
      if (dr) {
        var ymd = dr.match(/(\d{4})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/);
        if (ymd) {
          var dt = clampDate(+ymd[1], +ymd[2], +ymd[3]);
          if (dt) dateStr = toDateStr(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
        } else {
          var md = dr.match(/^(\d{1,2})\s*[-\/月]\s*(\d{1,2})/);
          if (md) {
            var dt2 = clampDate(new Date().getFullYear(), +md[1], +md[2]);
            if (dt2) dateStr = toDateStr(dt2.getFullYear(), dt2.getMonth() + 1, dt2.getDate());
          }
        }
      }

      var hrRaw = String(get(cHr)).replace(/[^\d.]/g, '');
      var hr = hrRaw ? parseInt(hrRaw, 10) : null;
      if (hr && (hr < 60 || hr > 230)) hr = null;

      var typeRaw = get(cType) || '';
      var noteRaw = get(cNote) || '';

      var run = norm({
        date: dateStr, distance: km, seconds: sec, hr: hr,
        type: guessType(typeRaw + ' ' + noteRaw),
        note: '从表格导入' + (noteRaw ? '：' + noteRaw : '')
      });
      if (valid(run)) runs.push(run);
      else failed.push('第 ' + (i + 1) + ' 行：数据不合理，已跳过');
    }
    return { runs: runs, failed: failed };
  }

  /* ---------------- 5. JSON ---------------- */
  function parseJSON(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return { runs: [], failed: ['JSON 格式不正确'] }; }

    // 本项目自己的备份格式
    if (data && data.runs && Array.isArray(data.runs)) {
      var rs = data.runs.map(function (r) {
        return norm({
          date: r.date, distance: Number(r.distance), seconds: Number(r.seconds),
          hr: r.hr ? Number(r.hr) : null, type: r.type,
          note: (r.note || '') + '（从备份导入）'
        });
      }).filter(valid);
      return { runs: rs, failed: [] };
    }

    var list = Array.isArray(data) ? data : (data.items || data.data || data.records);
    if (!Array.isArray(list)) return { runs: [], failed: ['没找到可以导入的记录数组'] };

    var runs = [], failed = [];
    list.forEach(function (o, i) {
      if (!o || typeof o !== 'object') return;
      var km = Number(o.distance || o.km || o.dist || o.距离);
      if (!km && o.meters) km = Number(o.meters) / 1000;
      var sec = Number(o.seconds || o.duration || o.dur || o.时长);
      if (!sec && o.durationMs) sec = Number(o.durationMs) / 1000;
      var date = o.date || o.startTime || o.start_time || o.time;
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(date)) date = date.slice(0, 10);
      if (!(km > 0) || !(sec > 20)) { failed.push('第 ' + (i + 1) + ' 条：数据不完整'); return; }
      var run = norm({
        date: typeof date === 'string' ? date.slice(0, 10) : null,
        distance: km, seconds: sec,
        hr: o.hr || o.heartRate || o.平均心率 || null,
        type: guessType((o.type || '') + ' ' + (o.name || '')),
        note: '从 JSON 导入'
      });
      if (valid(run)) runs.push(run); else failed.push('第 ' + (i + 1) + ' 条：数据不合理');
    });
    return { runs: runs, failed: failed };
  }

  /* ---------------- 入口 ---------------- */
  function parseFile(name, content) {
    var ext = String(name || '').toLowerCase().split('.').pop();
    if (ext === 'gpx') return parseGPX(content);
    if (ext === 'tcx') return parseTCX(content);
    if (ext === 'json') return parseJSON(content);
    if (ext === 'csv' || ext === 'tsv') return parseCSV(content);
    if (ext === 'txt') {
      var t = parseText(content);
      if (t.runs.length) return t;
      return parseCSV(content);
    }
    // 兜底：先当文本，再当表格
    var a = parseText(content);
    if (a.runs.length) return a;
    return parseCSV(content);
  }

  /* 标记可能与已有记录重复的条目 */
  function markDuplicates(runs, existing) {
    return runs.map(function (r) {
      var dup = existing.some(function (e) {
        return e.date === r.date && Math.abs(e.distance - r.distance) < 0.06;
      });
      r._dup = dup;
      r._keep = !dup;
      return r;
    });
  }

  return {
    parse: parseFile,
    parseText: parseText,
    parseGPX: parseGPX,
    parseTCX: parseTCX,
    parseCSV: parseCSV,
    parseJSON: parseJSON,
    markDuplicates: markDuplicates,
    TYPE_LABEL: TYPE_LABEL
  };
})();
