// 交通費申請アプリ：オフラインで動かすための仕組み＋「共有」でJSONを受け取る
var CACHE = "koutsuhi-202611261646";
var FILES = ["./", "index.html", "app.js", "core.js", "data.js", "jszip.min.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("koutsuhi-") === 0 && k !== CACHE && k !== "koutsuhi-share"; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  // 「共有」→このアプリ：ファイルを一時置き場に入れて画面に渡す（外には送らない）
  if (e.request.method === "POST" && url.pathname.slice(-13) === "/share-target") {
    e.respondWith(e.request.formData().then(function (fd) {
      var f = fd.get("file");
      return caches.open("koutsuhi-share").then(function (c) {
        return f ? c.put("shared-json", new Response(f)) : null;
      }).then(function () { return Response.redirect("./?shared=1", 303); });
    }));
    return;
  }
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // 電波があれば最新を取りに行き、無ければ保存しておいた版で動く
  e.respondWith(fetch(e.request).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match("index.html"); });
  }));
});
