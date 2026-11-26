(function () {
  "use strict";
  var VERSION = "202611261647";
  var $ = function (id) { return document.getElementById(id); };
  var TL = null, RES = null, DAYS = null, CUR = null, LASTFILE = null, KOKYU = {};
  var MODE_JA = { inpassengervehicle: "車", invehicle: "車", driving: "車", inbus: "バス", insubway: "地下鉄",
                  intrain: "電車", intram: "路面電車", walking: "徒歩", cycling: "自転車", flying: "飛行機",
                  inferry: "フェリー", running: "走る", unknown: "不明", "": "不明" };
  var PROFILE = ["shozoku", "shimei", "jusho", "commute", "rate"];
  var store = {
    get: function () { try { return JSON.parse(localStorage.getItem("koutsuhi_app") || "{}"); } catch (e) { return {}; } },
    set: function (o) { try { localStorage.setItem("koutsuhi_app", JSON.stringify(o)); } catch (e) {} },
    clear: function () { try { localStorage.removeItem("koutsuhi_app"); } catch (e) {} }
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toInt(v) { var n = parseInt(String(v == null ? "" : v).replace(/[,，\s]/g, "").replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }), 10); return isNaN(n) ? null : n; }
  function yen(n) { return n.toLocaleString("ja-JP") + "円"; }
  function cfg() { var c = {}; PROFILE.forEach(function (k) { c[k] = $(k).value.trim(); }); return c; }
  function hhmm(t) { return (t.h < 10 ? "0" : "") + t.h + ":" + (t.mi < 10 ? "0" : "") + t.mi; }
  function ll(p) { return p[0].toFixed(6) + "," + p[1].toFixed(6); }
  $("ver").textContent = "v" + VERSION;

  // ---- ホーム画面に追加
  var deferred = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; $("installCard").classList.remove("hide"); });
  $("installBtn").addEventListener("click", function () { if (deferred) { deferred.prompt(); deferred = null; $("installCard").classList.add("hide"); } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});

  // ---- 申請者
  var S = store.get();
  PROFILE.forEach(function (k) { if (S[k] != null && S[k] !== "") $(k).value = S[k]; });
  function profDone() { var c = cfg(); return c.shozoku && c.shimei && c.jusho && toInt(c.commute) != null; }
  function showProf() {
    var c = cfg();
    if (profDone()) {
      $("profText").innerHTML = "<b>" + esc(c.shimei) + "</b>（" + esc(c.shozoku) + "）<br><span class=\"hint\">通勤手当 " + yen(toInt(c.commute)) + "／単価 " + (toInt(c.rate) || 20) + "円</span>";
      $("profView").classList.remove("hide"); $("profForm").classList.add("hide");
    } else { $("profView").classList.add("hide"); $("profForm").classList.remove("hide"); }
  }
  showProf();
  $("profEdit").addEventListener("click", function () { $("profView").classList.add("hide"); $("profForm").classList.remove("hide"); });
  $("profSave").addEventListener("click", function () {
    if (!profDone()) { alertMsg($("profSave"), "所属・氏名・住所・通勤手当（無い方は0）を入れてください"); return; }
    var s = store.get(); PROFILE.forEach(function (k) { s[k] = $(k).value.trim(); }); store.set(s); showProf(); if (DAYS) render();
  });
  function alertMsg(el, t) { var p = el.nextElementSibling; if (p) { p.innerHTML = '<span class="err">' + esc(t) + "</span>"; } }

  // ---- 月・公休
  var now = new Date(), pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  $("ym").value = pm.getFullYear() + "-" + String(pm.getMonth() + 1).padStart(2, "0");
  function loadMonth() {
    var s = store.get(), ym = $("ym").value;
    $("odo").value = (s.odo && s.odo[ym] != null) ? s.odo[ym] : (s.next && s.next[ym] != null ? s.next[ym] : "");
    KOKYU = {}; ((s.kokyu && s.kokyu[ym]) || []).forEach(function (d) { KOKYU[d] = 1; });
    drawCal();
  }
  function drawCal() {
    var ym = $("ym").value; if (!ym) return;
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7), last = KC.daysIn(y, m), first = new Date(y, m - 1, 1).getDay();
    var h = "", wd = "日月火水木金土";
    for (var i = 0; i < 7; i++) h += '<div class="h' + (i === 0 ? " sun" : i === 6 ? " sat" : "") + '">' + wd[i] + "</div>";
    for (i = 0; i < first; i++) h += "<div></div>";
    for (var d = 1; d <= last; d++) {
      var w = (first + d - 1) % 7;
      h += '<button type="button" data-d="' + d + '" class="' + (KOKYU[d] ? "on " : "") + (w === 0 ? "sun" : w === 6 ? "sat" : "") + '">' + d + "</button>";
    }
    $("cal").innerHTML = h;
    var ks = Object.keys(KOKYU).map(Number).sort(function (a, b) { return a - b; });
    $("kokyuText").textContent = ks.length ? "公休 " + ks.length + "日：" + ks.join("・") : "公休の日を押してください（茶色になります）";
  }
  $("cal").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var d = +b.dataset.d; if (KOKYU[d]) delete KOKYU[d]; else KOKYU[d] = 1;
    var s = store.get(); s.kokyu = s.kokyu || {}; s.kokyu[$("ym").value] = Object.keys(KOKYU).map(Number); store.set(s);
    drawCal();
  });
  $("ym").addEventListener("change", loadMonth);
  loadMonth();

  // ---- ファイル
  if (/Android/i.test(navigator.userAgent)) { $("openSettings").classList.remove("hide"); $("openHint").classList.remove("hide"); }
  $("pick").addEventListener("click", function () { $("file").click(); });
  $("file").addEventListener("change", function () { if (this.files[0]) readFile(this.files[0]); this.value = ""; });
  function readFile(f) {
    var info = $("fileInfo");
    info.innerHTML = "読み込み中…（数秒かかります）";
    var fr = new FileReader();
    fr.onload = function () { loadText(String(fr.result), f.name || "タイムライン.json"); };
    fr.onerror = function () { info.innerHTML = '<span class="err">ファイルを開けませんでした。</span>'; };
    fr.readAsText(f, "utf-8");
  }
  function loadText(text, name) {
    var info = $("fileInfo");
    try {
      TL = KC.collect(JSON.parse(text.replace(/^﻿/, "")));
      if (!TL.rows.length) throw new Error("移動の記録が見つかりませんでした。");
      var mn = TL.rows[0].start, mx = TL.rows[0].start;
      TL.rows.forEach(function (r) { if (r.start.ms < mn.ms) mn = r.start; if (r.start.ms > mx.ms) mx = r.start; });
      TL.span = [mn, mx];
      info.innerHTML = '<span class="ok">✓ 読み込みました</span>　' + esc(name) + "<br>記録の期間：<b>" +
        mn.y + "/" + mn.m + "/" + mn.d + " 〜 " + mx.y + "/" + mx.m + "/" + mx.d + "</b>";
      $("calc").disabled = false;
    } catch (e) {
      TL = null; $("calc").disabled = true;
      info.innerHTML = '<span class="err">読み込めませんでした。</span>' + esc(e.message || e) + "<br>「タイムライン データをエクスポート」で書き出した .json を選んでください。";
    }
  }
  // 「共有」から受け取ったファイル
  if (/[?&]shared=1/.test(location.search) && "caches" in window) {
    history.replaceState(null, "", location.pathname);
    caches.open("koutsuhi-share").then(function (c) {
      return c.match("shared-json").then(function (r) {
        if (!r) return;
        $("fileInfo").innerHTML = "読み込み中…";
        return r.text().then(function (t) { loadText(t, "共有されたファイル"); return c.delete("shared-json"); });
      });
    });
  }

  // ---- 計算
  $("calc").addEventListener("click", function () {
    var msg = $("calcMsg"); msg.textContent = "";
    var ym = $("ym").value, odo = toInt($("odo").value), miss = [];
    if (!profDone()) miss.push("1の申請者の情報");
    if (!ym) miss.push("対象の月"); if (odo == null) miss.push("出社時キロ数");
    if (miss.length) { msg.innerHTML = '<span class="err">入っていない項目があります：' + miss.join("・") + "</span>"; return; }
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7), first = TL.span[0], last = TL.span[1];
    if (y * 100 + m < first.y * 100 + first.m || y * 100 + m > last.y * 100 + last.m) {
      msg.innerHTML = '<span class="err">' + y + "年" + m + "月の記録がありません（入っているのは " + first.y + "/" + first.m + "/" + first.d + "〜" + last.y + "/" + last.m + "/" + last.d + "）</span>"; return;
    }
    var warn = last.ms < Date.UTC(y, m, 1) - 9 * 3600000 ? '<span class="err">注意：記録が ' + last.m + "/" + last.d + " で終わっています。月が終わってから書き出し直してください。</span><br>" : "";
    RES = KC.buildMonth(TL, y, m, CHITEN);
    DAYS = KC.makeDays(RES, y, m, KOKYU);
    CUR = { y: y, m: m, odo: odo };
    var s = store.get(); s.odo = s.odo || {}; s.odo[ym] = odo; store.set(s);
    msg.innerHTML = warn + (RES.info.home ? "" : '<span class="err">自宅の場所が見つかりませんでした。帰宅の判定は行いません。</span>');
    $("result").classList.remove("hide"); $("bar").classList.remove("hide"); 
    render();
    $("result").scrollIntoView({ behavior: "smooth" });
  });

  function render() {
    var c = cfg(), rate = toInt(c.rate) || 20, commute = toInt(c.commute) || 0, od = CUR.odo, tot = 0, fares = 0, nday = 0, h = "";
    DAYS.forEach(function (d, i) {
      var net = KC.carKm(d), ok = KC.isOk(d), mk = KC.markOf(d);
      if (ok) { od += net; tot += net; fares += KC.fareOf(d); nday++; }
      var why = !ok ? (d.kokyu ? "公休" : (d.km > 0 && !d.work ? "外した日" : (d.km > 0 ? "電車のみ" : "車の記録なし"))) : "";
      h += '<div class="day' + (ok ? "" : " rest") + '" data-i="' + i + '">' +
        '<div class="d">' + d.d + "<small>" + d.wd + "</small></div>" +
        '<input type="text" class="route" value="' + esc(d.route) + '" placeholder="' + (ok ? "移動経路" : why) + '">' +
        '<div class="r"><input type="text" inputmode="numeric" class="k" value="' + d.km + '"><span>㎞</span></div>' +
        '<div class="sub"><label class="sw"><input type="checkbox" class="w"' + (d.work ? " checked" : "") + ">出勤</label>" +
        '<label>電車の運賃 <input type="text" inputmode="numeric" class="fr" value="' + (d.fare || "") + '" placeholder="0">円</label>' +
        (ok ? "<span>→ " + od.toLocaleString() + "㎞</span>" : "<span>" + why + "</span>") +
        (mk[0] ? '<span class="mk ' + mk[1] + '">' + mk[0] + "</span>" : "") + "</div></div>";
    });
    $("days").innerHTML = h;
    var g = tot * rate + fares;
    $("sum").innerHTML = "<div><span>出勤</span><b>" + nday + "日</b></div><div><span>車の走行</span><b>" + tot.toLocaleString() + "㎞</b></div>" +
      "<div><span>車の金額</span><b>" + yen(tot * rate) + "</b></div><div><span>電車の運賃</span><b>" + yen(fares) + "</b></div>" +
      "<div><span>通勤手当</span><b>−" + yen(commute) + "</b></div><div><span>メーター</span><b>" + od.toLocaleString() + "</b></div>";
    $("barMoney").textContent = yen(g - commute);
    renderFlags();
  }
  $("days").addEventListener("change", function (e) {
    var row = e.target.closest(".day"); if (!row) return;
    var d = DAYS[+row.dataset.i], t = e.target;
    if (t.classList.contains("w")) d.work = t.checked;
    else if (t.classList.contains("k")) { var v = toInt(t.value); d.km = v == null ? 0 : Math.max(v, 0); }
    else if (t.classList.contains("fr")) { var f = toInt(t.value); d.fare = f == null ? 0 : Math.max(f, 0); if (d.fare > 0) d.work = true; }
    else if (t.classList.contains("route")) { d.route = t.value; return; }
        render();
  });

  function gmap(points) { return "https://www.google.com/maps/dir/" + points.map(ll).join("/"); }
  function renderFlags() {
    var home = RES.info.home, f = RES.info.road_factor || 1.2, out = [];
    DAYS.forEach(function (d) {
      var mk = KC.markOf(d)[0], rec = d.rec; if (!mk || !rec) return;
      var pts = (home ? [home] : []).concat(rec.stops || []).concat(home ? [home] : []);
      var link = pts.length >= 2 ? ' <a href="' + gmap(pts) + '" target="_blank" rel="noopener">その日の道のりを地図で見る</a>' : "";
      var t = CUR.m + "/" + d.d + "（" + d.wd + "）";
      if (mk === "帰りの記録なし") out.push('<div class="flag"><b>' + t + " 帰りの記録なし</b>：最後が自宅から約" + rec.kitaku_nashi.toFixed(0) + "㎞の所で終わっています。" + link + "</div>");
      else if (mk === "距離不足の疑い") {
        var lo = Math.round(d.km + rec.nuke_km * f), hi = Math.round(d.km + (rec.nuke_km + (rec.tobi_km || 0)) * f);
        out.push('<div class="flag"><b>' + t + " 距離不足の疑い</b>：いま " + d.km + "㎞ → 実際は <b>" + (lo === hi ? lo : lo + "〜" + hi) + "㎞</b> の可能性。" +
          (rec.nuke || []).map(function (g) { return hhmm(g.t0) + "〜" + hhmm(g.t1) + "の記録なし"; }).join("、") + "。" + link + "</div>");
      } else if (mk === "元データ要確認") {
        out.push('<div class="flag"><b>' + t + " 元データ要確認</b>：手段がはっきりしない区間があります（車として数えています）。バス・電車だった場合は、走行㎞を直して運賃を入れてください。<br>" +
          rec.aimai.map(function (a) {
            var mj = MODE_JA[String(a.mode || "").toLowerCase().replace(/[^a-z]/g, "")] || a.mode;
            return hhmm(a.start) + (a.end ? "〜" + hhmm(a.end) : "") + " " + a.km.toFixed(1) + "㎞（判定：" + esc(mj) + (a.prob != null ? "・" + Math.round(a.prob * 100) + "%" : "") + "）" +
              (a.s_ll && a.e_ll ? ' <a href="' + gmap([a.s_ll, a.e_ll]) + '" target="_blank" rel="noopener">地図</a>' : "");
          }).join("<br>") + "</div>");
      } else if (mk === "要確認") out.push('<div class="flag o"><b>' + t + " 要確認</b>：" + d.km + "㎞走っています。距離が正しいか確認してください。" + link + "</div>");
    });
    $("flags").innerHTML = out.length ? '<h3 style="margin:0 0 4px;font-size:15px;color:var(--green)">印の付いた日（' + out.length + "日）</h3>" + out.join("") : "";
  }

  // ---- Excel / PDF
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  // 申請書ファイルを作る。send=true なら共有（LINE WORKS など）、false なら端末に保存
  function makeFile(kind, send) {
    var c = cfg(), btn = $((kind === "pdf" ? "pdf" : "dl") + (send ? "Send" : "")), label = btn.textContent;
    btn.disabled = true; btn.textContent = "作成中…";
    var job = kind === "pdf" ? KC.writePdf(CUR.y, CUR.m, DAYS, c, CUR.odo)
                             : KC.writeXlsx(JSZip, b64(TPL_B64), CUR.y, CUR.m, DAYS, c, CUR.odo);
    function done(t) { btn.textContent = t; setTimeout(function () { btn.textContent = label; btn.disabled = false; }, 2000); }
    job.then(function (r) {
      var name = "自家用車使用距離申請書_" + CUR.y + "年" + String(CUR.m).padStart(2, "0") + "月_" + c.shimei.replace(/[\s　]/g, "") + (kind === "pdf" ? ".pdf" : ".xlsx");
      var type = kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      var nm = CUR.m === 12 ? (CUR.y + 1) + "-01" : CUR.y + "-" + String(CUR.m + 1).padStart(2, "0");
      var s = store.get(); s.next = s.next || {}; s.next[nm] = r.lastOdo; store.set(s);
      var file = null;
      try { file = new File([r.bin], name, { type: type }); } catch (e) { file = null; }
      if (send && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: name }).then(function () { done("✓ 送りました"); }, function () { done(label); });
        return;
      }
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([r.bin], { type: type })); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      if (send) $("calcMsg").innerHTML = '<span class="err">この端末では「送る」が使えないため、保存しました。保存したファイルを添付して送ってください。</span>';
      done("✓ 保存");
    }).catch(function (e) { btn.textContent = label; btn.disabled = false; $("calcMsg").innerHTML = '<span class="err">作成できませんでした：' + esc(e.message || e) + "</span>"; });
  }
  $("pdf").addEventListener("click", function () { makeFile("pdf", false); });
  $("pdfSend").addEventListener("click", function () { makeFile("pdf", true); });
  $("dl").addEventListener("click", function () { makeFile("xlsx", false); });
  $("dlSend").addEventListener("click", function () { makeFile("xlsx", true); });

  $("forget").addEventListener("click", function () {
    store.clear(); PROFILE.forEach(function (k) { $(k).value = k === "rate" ? "20" : ""; });
    KOKYU = {}; $("odo").value = ""; drawCal(); showProf();
    $("forgetMsg").textContent = "消しました。";
  });
})();
