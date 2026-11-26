// 自家用車使用距離申請書 作成 — 計算の本体（koutsuhi_gui.py / soukou_shukei.py をそのまま移植）
(function (root) {
  "use strict";

  var CAR_MODES = { inpassengervehicle: 1, invehicle: 1, driving: 1 };
  var AIMAI_MODES = { invehicle: 1, unknown: 1, "": 1 };
  var KAKUNIN_KM = 100, AIMAI_KM = 5.0, AIMAI_PROB = 0.7;
  var GAP_MIN_KM = 5.0, GAP_MAX_KMH = 110.0;
  var MATAGI_HOUR = 5, MATAGI_HOME_M = 2000, HOME_END_KM = 3.0;
  var HOME_R = 400, MIN_KM = 0.3;
  var DAY = 86400000, JST = 9 * 3600000;
  var WD = "月火水木金土日";

  // ---------------------------------------------------------------- 小道具
  function normMode(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z]/g, ""); }

  function parseLatLng(v) {
    if (v == null) return null;
    if (typeof v === "object") {
      var keys = ["latLng", "latlng", "point"];
      for (var i = 0; i < keys.length; i++) if (keys[i] in v) return parseLatLng(v[keys[i]]);
      if ("latitudeE7" in v && "longitudeE7" in v) return [v.latitudeE7 / 1e7, v.longitudeE7 / 1e7];
      return null;
    }
    var nums = String(v).match(/-?\d+\.?\d*/g);
    if (nums && nums.length >= 2) return [parseFloat(nums[0]), parseFloat(nums[1])];
    return null;
  }

  function hav(a, b) {
    if (!a || !b) return null;
    var r = 6371000.0, rad = Math.PI / 180;
    var p1 = a[0] * rad, p2 = b[0] * rad, dp = p2 - p1, dl = (b[1] - a[1]) * rad;
    var h = Math.pow(Math.sin(dp / 2), 2) + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin(dl / 2), 2);
    return 2 * r * Math.asin(Math.sqrt(h));
  }
  function or(v, d) { return (v == null || v === 0 || isNaN(v)) ? d : v; }   // Python の「x or d」

  // ISO8601 -> {ms, y, m, d, h, mi, wd, key}（日本時間）
  function T(ms) {
    var j = new Date(ms + JST);
    return { ms: ms, y: j.getUTCFullYear(), m: j.getUTCMonth() + 1, d: j.getUTCDate(),
             h: j.getUTCHours(), mi: j.getUTCMinutes(), wd: (j.getUTCDay() + 6) % 7 };
  }
  function toJst(s) {
    if (!s) return null;
    var t = String(s).trim();
    if (!/(Z|[+-]\d\d:?\d\d)$/.test(t)) t += "+09:00";
    var ms = Date.parse(t);
    return isNaN(ms) ? null : T(ms);
  }
  function toFloat(v) {
    if (v == null) return null;
    var f = parseFloat(String(v).replace(/,/g, ""));
    return isNaN(f) ? null : f;
  }
  function dkey(t) { return t.y * 10000 + t.m * 100 + t.d; }
  function prevDay(t) { var j = new Date(Date.UTC(t.y, t.m - 1, t.d) - DAY); return { y: j.getUTCFullYear(), m: j.getUTCMonth() + 1, d: j.getUTCDate() }; }
  function nextKey(y, m, d) { var j = new Date(Date.UTC(y, m - 1, d) + DAY); return j.getUTCFullYear() * 10000 + (j.getUTCMonth() + 1) * 100 + j.getUTCDate(); }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  // Python の round()（偶数丸め）
  function pyRound(x) {
    var f = Math.floor(x), diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return (f % 2 === 0) ? f : f + 1;
  }

  // ---------------------------------------------------------------- 読み込み
  function extractNew(seg) {
    var act = seg.activity;
    if (!act || typeof act !== "object") return null;
    var cand = act.topCandidate || {};
    var mode = (cand && typeof cand === "object") ? cand.type : null;
    if (mode == null) mode = act.type;
    var dist = toFloat(act.distanceMeters);
    var s_ll = parseLatLng(act.start), e_ll = parseLatLng(act.end);
    if (dist == null) dist = hav(s_ll, e_ll);
    var prob = (cand && typeof cand === "object") ? toFloat(cand.probability) : null;
    return { start: toJst(seg.startTime), end: toJst(seg.endTime), mode: mode, dist_m: dist,
             prob: prob, s_ll: s_ll, e_ll: e_ll };
  }
  function extractVisitNew(seg) {
    var v = seg.visit;
    if (!v || typeof v !== "object") return null;
    var tc = v.topCandidate || {};
    var ll = parseLatLng(tc.placeLocation);
    if (!ll) return null;
    return { start: toJst(seg.startTime), end: toJst(seg.endTime), ll: ll,
             sem: String(tc.semanticType || "").toUpperCase() };
  }

  function collect(obj) {
    var items;
    if (obj && !Array.isArray(obj) && obj.semanticSegments) items = obj.semanticSegments;
    else if (Array.isArray(obj)) items = obj;
    else throw new Error("タイムラインのファイルではないようです。スマホの「タイムライン データをエクスポート」で書き出したファイルを選んでください。");
    var rows = [], visits = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it !== "object") continue;
      var v = extractVisitNew(it);
      if (v && v.start) visits.push(v);
      var r = extractNew(it);
      if (!r || !r.start || !r.dist_m) continue;
      r.mode_key = normMode(r.mode);
      rows.push(r);
    }
    return { rows: rows, visits: visits };
  }

  // ---------------------------------------------------------------- 地点
  function matchChiten(ll, chiten) {
    var best = null, bestD = null;
    for (var i = 0; i < chiten.length; i++) {
      var c = chiten[i], d = hav(ll, [c[1], c[2]]);
      if (d != null && d <= c[3] && (bestD == null || d < bestD)) { best = c; bestD = d; }
    }
    return best ? [best[0], best[4]] : [null, ""];
  }

  function clusterVisits(visits, radius) {
    var cl = [];
    for (var i = 0; i < visits.length; i++) {
      var v = visits[i], hit = false;
      for (var j = 0; j < cl.length; j++) {
        if (or(hav(v.ll, cl[j].ll), 9e9) <= radius) {
          cl[j].n++; cl[j].mins += v.mins; hit = true; break;
        }
      }
      if (!hit) cl.push({ ll: v.ll, n: 1, mins: v.mins, idx: cl.length });
    }
    cl.sort(function (a, b) { return (b.n - a.n) || (b.mins - a.mins) || (a.idx - b.idx); });
    return cl;
  }
  function detectHome(visits) {
    var homes = visits.filter(function (v) { return v.sem.indexOf("HOME") >= 0; });
    if (!homes.length) return [null, 0];
    var cl = clusterVisits(homes, 200.0);
    return cl.length ? [cl[0].ll, cl[0].n] : [null, 0];
  }

  function roadFactor(rows) {
    var by = {};
    rows.forEach(function (r) { (by[dkey(r.start)] = by[dkey(r.start)] || []).push(r); });
    var rs = [];
    Object.keys(by).forEach(function (k) {
      var car = by[k].filter(function (s) { return CAR_MODES[s.mode_key]; });
      var st = 0, hi = 0;
      car.forEach(function (s) { st += or(hav(s.s_ll, s.e_ll), 0); hi += s.dist_m; });
      st /= 1000; hi /= 1000;
      if (st >= 5 && hi >= st) rs.push(hi / st);
    });
    rs.sort(function (a, b) { return a - b; });
    return rs.length ? rs[Math.floor(rs.length / 2)] : 1.2;
  }

  function findGaps(segs) {
    segs = segs.slice().sort(function (a, b) { return a.start.ms - b.start.ms; });
    var nuke = 0, tobi = 0, detail = [];
    for (var i = 0; i + 1 < segs.length; i++) {
      var a = segs[i], b = segs[i + 1];
      if (!a.e_ll || !b.s_ll || !a.end) continue;
      var g = or(hav(a.e_ll, b.s_ll), 0) / 1000;
      if (g < GAP_MIN_KM) continue;
      var mins = (b.start.ms - a.end.ms) / 60000;
      var kmh = mins > 0 ? g / (mins / 60) : 9999;
      if (kmh > GAP_MAX_KMH) tobi += g;
      else { nuke += g; detail.push({ t0: a.end, t1: b.start, km: g, mins: mins, p: a.e_ll, q: b.s_ll }); }
    }
    return [nuke, tobi, detail];
  }

  function parseDays(text) {
    var out = {};
    String(text || "").replace(/、/g, ",").replace(/　/g, " ").replace(/ /g, ",")
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .split(",").forEach(function (chunk) {
        var c = chunk.trim().replace(/[〜~–ー－]/g, "-").replace(/日/g, "");
        if (!c) return;
        if (c.indexOf("-") >= 0) {
          var p = c.split("-"), a = parseInt(p[0], 10), b = parseInt(p[1], 10);
          if (!isNaN(a) && !isNaN(b)) for (var d = a; d <= b; d++) out[d] = 1;
        } else { var n = parseInt(c, 10); if (!isNaN(n)) out[n] = 1; }
      });
    var r = {};
    Object.keys(out).forEach(function (d) { d = +d; if (d >= 1 && d <= 31) r[d] = 1; });
    return r;
  }

  // ---------------------------------------------------------------- 日別
  function newRec() { return { km: 0, densha: 0, n: 0, visits: [], aimai: [] }; }

  function buildMonth(tl, y, m, chiten) {
    var rows = tl.rows, data = {}, info = {};
    var visits = tl.visits.map(function (v) {
      var mins = v.end ? (v.end.ms - v.start.ms) / 60000 : 0;
      return { start: v.start, ll: v.ll, sem: v.sem, mins: Math.max(mins, 0) };
    });
    if (rows.length) {
      var mn = rows[0].start, mx = rows[0].start;
      rows.forEach(function (r) { if (r.start.ms < mn.ms) mn = r.start; if (r.start.ms > mx.ms) mx = r.start; });
      info.span = [mn, mx];
    }
    var hd = detectHome(visits), home = hd[0];
    info.home = home; info.home_n = hd[1];

    rows.forEach(function (r) {
      var tgt = { y: r.start.y, m: r.start.m, d: r.start.d }, matagi = false;
      if (home && r.start.h < MATAGI_HOUR && CAR_MODES[r.mode_key] &&
          or(hav(r.e_ll, home), 9e9) <= MATAGI_HOME_M) { tgt = prevDay(r.start); matagi = true; }
      if (tgt.y !== y || tgt.m !== m) return;
      var km = r.dist_m / 1000, isCar = !!CAR_MODES[r.mode_key];
      if (!isCar && (AIMAI_MODES[r.mode_key] || (r.prob != null && r.prob < AIMAI_PROB && km >= AIMAI_KM))) isCar = true;
      if (km >= AIMAI_KM && (AIMAI_MODES[r.mode_key] || (r.prob != null && r.prob < AIMAI_PROB))) {
        var ra = data[tgt.d] = data[tgt.d] || newRec();
        ra.aimai.push({ start: r.start, end: r.end, km: km, mode: r.mode, prob: r.prob, counted: isCar, s_ll: r.s_ll, e_ll: r.e_ll });
      }
      if (!isCar || km < MIN_KM) return;
      var rec = data[tgt.d] = data[tgt.d] || newRec();
      rec.km += km;
      if (matagi) rec.matagi = (rec.matagi || 0) + km;
      if (r.end && (rec.last_t == null || r.end.ms > rec.last_t)) { rec.last_t = r.end.ms; rec.last_ll = r.e_ll; }
      if (rec.first_t == null || r.start.ms < rec.first_t) { rec.first_t = r.start.ms; rec.first_ll = r.s_ll; }
      rec.n++;
    });

    info.road_factor = roadFactor(rows);
    var perday = {};
    rows.forEach(function (r) {
      if (r.start.y === y && r.start.m === m) (perday[r.start.d] = perday[r.start.d] || []).push(r);
    });
    Object.keys(perday).forEach(function (d) {
      var rec = data[d]; if (!rec) return;
      var g = findGaps(perday[d]); rec.nuke_km = g[0]; rec.tobi_km = g[1]; rec.nuke = g[2];
    });

    visits.forEach(function (v) {
      if (v.start.y === y && v.start.m === m && data[v.start.d]) data[v.start.d].visits.push(v);
    });

    if (home) {
      var last = daysIn(y, m);
      for (var d = 1; d <= last; d++) {
        var rec = data[d];
        if (!rec || !rec.last_ll || or(rec.km, 0) < 1) continue;
        var far = or(hav(rec.last_ll, home), 0) / 1000;
        if (far < HOME_END_KM) continue;
        var nk = nextKey(y, m, d), nxt = (Math.floor(nk / 100) === y * 100 + m) ? data[nk % 100] : null;
        if (nxt && nxt.first_ll && or(hav(nxt.first_ll, home), 0) / 1000 >= HOME_END_KM) { rec.hakuhaku = true; continue; }
        rec.kitaku_nashi = far;
      }
    }

    Object.keys(data).forEach(function (d) {
      var rec = data[d];
      rec.visits.sort(function (a, b) { return a.start.ms - b.start.ms; });
      var names = [], away = false, stops = [];
      rec.visits.forEach(function (v) {
        if (home && or(hav(v.ll, home), 9e9) <= HOME_R) return;
        away = true;
        var mc = matchChiten(v.ll, chiten), nm = mc[0], kind = mc[1] || "";
        var skip = kind.indexOf("通勤先") >= 0 || kind.indexOf("私用") >= 0;
        if (nm && !skip && (!names.length || names[names.length - 1] !== nm)) { names.push(nm); stops.push(v.ll); }
      });
      rec.route = names.join("・");
      rec.stops = stops;
      rec.work = !(home && !away);
    });
    return { data: data, info: info };
  }

  // 公休を当てはめ、日ごとの行（画面と申請書の元）を作る
  function makeDays(res, y, m, yasumi) {
    var out = [], last = daysIn(y, m);
    for (var d = 1; d <= last; d++) {
      var rec = res.data[d] || null;
      var kmAll = rec ? pyRound(rec.km || 0) : 0;
      out.push({ d: d, wd: WD[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7],
                 rec: rec, kmAuto: kmAll, km: kmAll, densha: 0,
                 work: !!(rec && !yasumi[d] && (rec.km || 0) >= 1),
                 kokyu: !!yasumi[d], route: rec ? rec.route : "" });
    }
    return out;
  }

  function markOf(day) {
    var km = Math.max(day.km - day.densha, 0), rec = day.rec;
    if (!day.work || km <= 0) return day.densha > 0 ? ["電車のみ", "blue"] : ["", ""];
    if (day.densha > 0) return ["電車 " + day.densha + "㎞", "blue"];
    if (rec && rec.kitaku_nashi && km === day.kmAuto) return ["帰りの記録なし", "red"];
    if (rec && (rec.nuke_km || 0) >= GAP_MIN_KM && km === day.kmAuto) return ["距離不足の疑い", "red"];
    if (rec && rec.aimai.length && km === day.kmAuto) return ["元データ要確認", "red"];
    if (km >= KAKUNIN_KM) return ["要確認", "orange"];
    return ["", ""];
  }

  // ---------------------------------------------------------------- Excel
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function colNum(ref) { var c = ref.match(/^[A-Z]+/)[0], n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + c.charCodeAt(i) - 64; return n; }

  function setCell(xml, ref, val, styleMap) {
    var re = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)');
    var m = xml.match(re), s = "0";
    if (m) { var sm = m[1].match(/ s="(\d+)"/); if (sm) s = sm[1]; }
    if (styleMap) s = styleMap(s);
    var body;
    if (val == null || val === "") body = '<c r="' + ref + '" s="' + s + '" t="n"></c>';
    else if (typeof val === "number") body = '<c r="' + ref + '" s="' + s + '" t="n"><v>' + val + '</v></c>';
    else if (typeof val === "object" && val.f) body = '<c r="' + ref + '" s="' + s + '"><f>' + esc(val.f) + '</f><v></v></c>';
    else body = '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(val) + '</t></is></c>';
    if (m) return xml.replace(re, function () { return body; });
    // セルが無い → 行の中の列順の位置に差し込む
    var row = ref.match(/\d+$/)[0], rre = new RegExp('<row r="' + row + '"([^>]*?)(/>|>([\\s\\S]*?)</row>)');
    var rm = xml.match(rre);
    if (!rm) throw new Error("雛形に行 " + row + " がありません");
    var inner = rm[3] || "", cells = inner.match(/<c r="[A-Z]+\d+"[\s\S]*?(?:\/>|<\/c>)/g) || [], placed = false, outCells = [];
    cells.forEach(function (c) {
      var cr = c.match(/<c r="([A-Z]+)\d+"/)[1];
      if (!placed && colNum(cr) > colNum(ref)) { outCells.push(body); placed = true; }
      outCells.push(c);
    });
    if (!placed) outCells.push(body);
    return xml.replace(rre, function () { return '<row r="' + row + '"' + rm[1] + '>' + outCells.join("") + '</row>'; });
  }

  // tplBuf: 雛形xlsx（ArrayBuffer/Uint8Array）。戻り値は Uint8Array
  function writeXlsx(JSZip, tplBuf, y, m, days, cfg, startOdo) {
    return JSZip.loadAsync(tplBuf).then(function (zip) {
      return Promise.all([zip.file("xl/worksheets/sheet1.xml").async("string"),
                          zip.file("xl/styles.xml").async("string"),
                          zip.file("xl/workbook.xml").async("string")]).then(function (a) {
        var sh = a[0], st = a[1], wb = a[2];
        var rate = parseInt(cfg.rate, 10) || 20, last = daysIn(y, m);

        // 塗り（白・灰色）を足し、元の書式を複製して塗りだけ差し替える
        var fills = st.match(/<fills count="(\d+)">([\s\S]*?)<\/fills>/), nf = +fills[1];
        st = st.replace(fills[0], '<fills count="' + (nf + 2) + '">' + fills[2] +
          '<fill><patternFill patternType="solid"><fgColor rgb="00FFFFFF"/></patternFill></fill>' +
          '<fill><patternFill patternType="solid"><fgColor rgb="00D9D9D9"/></patternFill></fill></fills>');
        var xfsM = st.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
        var xfs = xfsM[2].match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g), added = [], cache = {};
        function fillStyle(fillId) {
          return function (s) {
            var k = s + ":" + fillId;
            if (cache[k] == null) {
              var x = xfs[+s].replace(/ fillId="\d+"/, "").replace(/ applyFill="\d+"/, "").replace(/^<xf /, '<xf fillId="' + fillId + '" applyFill="1" ');
              added.push(x); cache[k] = String(xfs.length + added.length - 1);
            }
            return cache[k];
          };
        }
        var WHITE = fillStyle(nf), GRAY = fillStyle(nf + 1);

        sh = setCell(sh, "B3", "所属　" + (cfg.shozoku || "") + "　　　　　　　　氏名　　" + (cfg.shimei || ""));
        sh = setCell(sh, "I3", y);
        sh = setCell(sh, "J3", m + "月分");
        sh = setCell(sh, "E5", "×" + rate + "円");
        sh = setCell(sh, "K37", -(parseInt(cfg.commute, 10) || 0));
        sh = setCell(sh, "G41", "　受領日 " + y + "　年　" + m + "月 　" + last + "日");
        sh = setCell(sh, "G46", cfg.jusho || "");
        sh = setCell(sh, "G47", cfg.shimei || "");

        var od = startOdo, prev = null, total = 0, nday = 0, COLS = ["B", "C", "D", "E", "F", "G"];
        for (var d = 1; d <= 31; d++) {
          var r = 5 + d;
          sh = setCell(sh, "A" + r, d <= last ? d : null);
          COLS.forEach(function (c) { sh = setCell(sh, c + r, null); });
        }
        days.forEach(function (day) {
          var r = 5 + day.d, km = Math.max(day.km - day.densha, 0), ok = day.work && km > 0;
          var sm = ok ? WHITE : GRAY;
          ["A"].concat(COLS).forEach(function (c) { sh = setCell(sh, c + r, c === "A" ? day.d : null, sm); });
          if (!ok) return;
          sh = setCell(sh, "B" + r, prev == null ? od : { f: "C" + prev });
          sh = setCell(sh, "C" + r, { f: "B" + r + "+D" + r });
          sh = setCell(sh, "D" + r, km);
          sh = setCell(sh, "E" + r, "×" + rate + "円");
          sh = setCell(sh, "F" + r, { f: "((D" + r + "*" + rate + "))+N" + r });
          sh = setCell(sh, "G" + r, day.route || null);
          od += km; total += km; nday++; prev = r;
        });

        st = st.replace(xfsM[0], '<cellXfs count="' + (xfs.length + added.length) + '">' + xfs.join("") + added.join("") + '</cellXfs>');
        if (/fullCalcOnLoad/.test(wb)) { /* そのまま */ }
        else if (/<calcPr/.test(wb)) wb = wb.replace(/<calcPr([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
        else wb = wb.replace("</workbook>", '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
        zip.file("xl/worksheets/sheet1.xml", sh);
        zip.file("xl/styles.xml", st);
        zip.file("xl/workbook.xml", wb);
        return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }).then(function (bin) {
          return { bin: bin, total: total, lastOdo: od, nday: nday };
        });
      });
    });
  }

  // ---------------------------------------------------------------- PDF（申請書と同じ配置を画像に描いてPDFに包む）
  // 座標は A4縦の pt（595×842）。Excel本体でPDFにした見本から採寸した。
  var FONT = '"Yu Gothic","YuGothic","Hiragino Sans","Noto Sans JP","Noto Sans CJK JP","Meiryo",sans-serif';
  function drawForm(canvas, y, m, days, cfg, startOdo) {
    var K = 3, W = 595.28, H = 841.89;
    canvas.width = Math.round(W * K); canvas.height = Math.round(H * K);
    var g = canvas.getContext("2d");
    g.setTransform(K, 0, 0, K, 0, 0);
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#000"; g.strokeStyle = "#000"; g.textBaseline = "middle";
    var rate = parseInt(cfg.rate, 10) || 20, commute = parseInt(cfg.commute, 10) || 0, last = daysIn(y, m);
    function font(px, bold) { g.font = (bold ? "bold " : "") + px + "px " + FONT; }
    function text(s, x, yy, px, align, bold, maxW) {
      s = String(s); font(px, bold); g.textAlign = align || "left";
      if (maxW) { var p = px; while (p > 4 && g.measureText(s).width > maxW) { p -= 0.25; font(p, bold); } }
      g.fillText(s, x, yy);
    }
    function line(x1, y1, x2, y2, w, dash) {
      g.lineWidth = w || 0.6; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
    }
    function box(x1, y1, x2, y2, w) { g.lineWidth = w || 0.6; g.strokeRect(x1, y1, x2 - x1, y2 - y1); }
    var C = [34, 48.4, 101.5, 154.5, 195, 233.7, 288, 564];   // 列の境目
    var T0 = 74, HD = 87, RH = 12.86, TE = HD + RH * 31;        // 表の上・見出し下・行の高さ・表の下

    text("自家用車使用距離申請書", W / 2, 37, 10.5, "center", true);
    text("所属　" + (cfg.shozoku || ""), 51, 65, 7.5);
    text("氏名　　" + (cfg.shimei || ""), 186, 65, 7.5);
    line(34, 71, 259, 71, 0.5);
    text("期間", 422, 65, 7.5); text(y + "年", 459, 65, 7.5); text(m + "月分", 514, 65, 7.5);

    // 見出し
    var hd = ["日付", "出社時キロ数", "退社時キロ数", "走行距離", "×" + rate + "円", "金　額", "移動経路、内容"];
    for (var i = 0; i < 7; i++) text(hd[i], (C[i] + C[i + 1]) / 2, (T0 + HD) / 2, i === 0 ? 5 : 7.5, "center", false, C[i + 1] - C[i] - 2);

    // 明細
    var od = startOdo, total = 0, byDay = {};
    days.forEach(function (d) { byDay[d.d] = d; });
    for (var dd = 1; dd <= 31; dd++) {
      var top = HD + RH * (dd - 1), mid = top + RH / 2, day = byDay[dd];
      var km = day ? Math.max(day.km - day.densha, 0) : 0, ok = day && day.work && km > 0;
      if (dd <= last && !ok) { g.fillStyle = "#D9D9D9"; g.fillRect(C[0], top, C[7] - C[0], RH); g.fillStyle = "#000"; }
      if (dd <= last) text(dd, (C[0] + C[1]) / 2, mid, 6.5, "center");
      if (ok) {
        text(od.toLocaleString("en-US") + "㎞", C[2] - 2, mid, 7.5, "right");
        text((od + km).toLocaleString("en-US") + "㎞", C[3] - 2, mid, 7.5, "right");
        text(km.toLocaleString("en-US") + "㎞", C[4] - 2, mid, 7.5, "right");
        text("×" + rate + "円", (C[4] + C[5]) / 2, mid, 5, "center");
        text((km * rate).toLocaleString("en-US") + "円", C[6] - 2, mid, 7.5, "right");
        if (day.route) text(day.route, C[6] + 2, mid, 7.5, "left", false, C[7] - C[6] - 4);
        od += km; total += km * rate;
      }
    }
    // 罫線
    box(C[0], T0, C[7], TE, 0.8);
    line(C[0], HD, C[7], HD);
    for (dd = 1; dd < 31; dd++) line(C[0], HD + RH * dd, C[7], HD + RH * dd, 0.4);
    for (i = 1; i < 7; i++) line(C[i], T0, C[i], TE, 0.4);
    line(C[0], TE, C[7], TE, 1.4);

    // 合計・通勤手当・使用料
    var R1 = TE + 1.5, R2 = R1 + 17, R3 = R2 + 1.5, R4 = R3 + 17;
    box(C[0], R1, C[7], R2, 1.2); line(C[5], R1, C[5], R2, 0.6); line(C[6], R1, C[6], R2, 1.2); line(500, R1, 500, R2, 0.6);
    text("合　計", C[5] - 10, (R1 + R2) / 2, 9, "right", true);
    text(total.toLocaleString("en-US") + "円", C[6] - 2, (R1 + R2) / 2, 7.5, "right");
    text("通勤手当", 488, (R1 + R2) / 2, 9, "right", true);
    text((-commute).toLocaleString("en-US") + "円", C[7] - 2, (R1 + R2) / 2, 7.5, "right");
    box(C[0], R3, C[6], R4, 1.2); line(C[5], R3, C[5], R4, 0.6);
    var net = total - commute;
    text("自家用車使用料", C[5] - 3, (R3 + R4) / 2, 9, "right", true);
    text(net.toLocaleString("en-US") + "円", C[6] - 2, (R3 + R4) / 2, 7.5, "right");

    // 受領書
    text("※　この申請書提出時に現金で精算の場合は、以下に記入してください。", 42, 534, 5.5);
    line(C[0], 540, C[7], 540, 0.7, [5, 2, 1.2, 2]);
    g.fillStyle = "#E6E6E6"; g.fillRect(C[0], 541, C[7] - C[0], 17); g.fillStyle = "#000";
    text("受　領　書", W / 2, 549.5, 9, "center", true);
    text("受領日 " + y + "　年　" + m + "月　" + last + "日", 298, 565, 7.5);
    line(288, 573, 564, 573, 0.6);
    text("（株）いとあ　　　　様", 60, 579, 7.5);
    line(49, 586, 195, 586, 0.6);
    text(y + "年  " + m + "月分", 126, 602, 7.5);
    text("自家用車使用料として", 198, 602, 7.5);
    text(net.toLocaleString("en-US") + "円", 353, 602, 11, "center");
    text("を受領いたしました。", 422, 602, 7.5);
    text("住所", 235, 628, 7.5); text(cfg.jusho || "", 290, 628, 7.5, "left", false, 270);
    text("氏名", 235, 648, 7.5); text(cfg.shimei || "", 290, 648, 7.5);
    return { total: total, net: net, lastOdo: od };
  }

  // JPEG 1枚を A4 1ページの PDF にする
  function makePdf(jpeg, pxW, pxH) {
    var enc = function (s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
    var parts = [], off = [], len = 0;
    function add(u) { parts.push(u); len += u.length; }
    function obj(n, head, bin, tail) { off[n] = len; add(enc(n + " 0 obj\n" + head)); if (bin) add(bin); add(enc((tail || "") + "\nendobj\n")); }
    add(enc("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
    var content = "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
    obj(4, "<< /Type /XObject /Subtype /Image /Width " + pxW + " /Height " + pxH + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>\nstream\n", jpeg, "\nendstream");
    obj(5, "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
    var x = len, s = "xref\n0 6\n0000000000 65535 f \n";
    for (var i = 1; i <= 5; i++) s += String(off[i]).padStart(10, "0") + " 00000 n \n";
    add(enc(s + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + x + "\n%%EOF\n"));
    var out = new Uint8Array(len), p = 0;
    parts.forEach(function (u) { out.set(u, p); p += u.length; });
    return out;
  }

  function writePdf(y, m, days, cfg, startOdo) {
    var cv = document.createElement("canvas");
    var r = drawForm(cv, y, m, days, cfg, startOdo);
    return new Promise(function (ok, ng) {
      cv.toBlob(function (b) {
        if (!b) { ng(new Error("画像を作れませんでした")); return; }
        b.arrayBuffer().then(function (ab) { r.bin = makePdf(new Uint8Array(ab), cv.width, cv.height); ok(r); }, ng);
      }, "image/jpeg", 0.9);
    });
  }

  root.KC = { writePdf: writePdf, drawForm: drawForm, makePdf: makePdf, collect: collect, buildMonth: buildMonth, makeDays: makeDays, markOf: markOf, parseDays: parseDays,
              writeXlsx: writeXlsx, daysIn: daysIn, hav: hav, GAP_MIN_KM: GAP_MIN_KM, KAKUNIN_KM: KAKUNIN_KM };
  if (typeof module !== "undefined") module.exports = root.KC;
})(typeof window !== "undefined" ? window : globalThis);
