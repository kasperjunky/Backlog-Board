// In-memory stand-in for the artifact `db` capability, for testing board.html
// outside claude.ai. Loaded before the board script. It mimics what the board
// uses: collection("items").onSnapshot, doc(path).{set,update,delete,onSnapshot},
// with every snapshot delivered asynchronously (as the real db does).
//
// Test hooks on window:
//   __seed()            the default documents (fresh copy)
//   __reset(docs?)      replace every document and notify subscribers
//   __remote(path, d)   merge `d` into a doc as if another tab / Claude wrote it
//   __writes            every write the board made: [op, path, data?]
//   __allWrites         the same, never cleared by __reset
//   __doc(path)         read a document as stored
//   __people / __viewer the fake directory and who is viewing (ids "u_…")
//   __leaseBusy         true: every acquire() answers as if another board holds it
//   __assets            { uploads, deletes, failNext }: the fake asset store
(function () {
  "use strict";
  var docs = {}, itemSubs = [], docSubs = {}, leases = {};
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function snapItems() {
    var list = Object.keys(docs).filter(function (k) { return k.indexOf("items/") === 0; }).map(function (k) {
      var d = clone(docs[k]);
      return { id: k.slice(6), data: function () { return clone(d); } };
    });
    var s = { docs: list, metadata: { fromCache: false } };
    itemSubs.forEach(function (cb) { cb(s); });
  }
  function fireDoc(path) {
    (docSubs[path] || []).forEach(function (cb) { var d = clone(docs[path]); cb({ data: function () { return d || null; } }); });
  }
  function fire(path) { if (path.indexOf("items/") === 0) snapItems(); fireDoc(path); }
  function later(fn) { setTimeout(fn, 0); }

  window.__writes = [];
  window.__allWrites = [];
  window.__doc = function (path) { return clone(docs[path]); };
  function rec(w) { window.__writes.push(w); window.__allWrites.push(w); }
  window.__seed = function () {
    return {
      "items/1": { name: "Alpha task", priority: "urgent", value: 4, effort: "S", notes: "note one", status: "todo", order: 1, addedAt: "2026-11-01", link: "javascript:alert(1)", due: "2026-01-01" },
      "items/4": { name: "Delta urgent", priority: "urgent", value: 3, effort: "M", notes: "", status: "todo", order: 2, addedAt: "2026-11-04", color: "red;background:url(x)" },
      "items/5": { name: "Echo urgent", priority: "urgent", value: 1, effort: "XL", notes: "", status: "todo", order: 3, addedAt: "2026-11-05" },
      "items/2": { name: "Beta task", priority: "important", value: 2, effort: "M", notes: "", status: "todo", order: 1, addedAt: "2026-11-02", link: "https://github.com/a/b/tree/%E0%A4", due: "2099-01-01" },
      "items/3": { name: "Gamma done", priority: "nice", value: 3, effort: "L", notes: "", status: "done", order: 1, addedAt: "2026-10-01", finishedAt: "2026-11-03" },
      "items/6": { name: "Zeta old done", priority: "nice", value: 2, effort: "S", notes: "", status: "done", order: 2, addedAt: "2025-12-01", finishedAt: "2026-01-15" }
    };
  };
  window.__reset = function (next) {
    docs = clone(next || window.__seed());
    leases = {}; window.__leaseBusy = false;
    window.__assets.uploads.length = 0; window.__assets.deletes.length = 0; window.__assets.failNext = null;
    window.__writes.length = 0;
    snapItems();
    Object.keys(docSubs).forEach(fireDoc);
  };
  window.__remote = function (path, d) { docs[path] = Object.assign({}, docs[path] || {}, clone(d)); fire(path); };

  var db = {
    collection: function () { return { onSnapshot: function (cb) { itemSubs.push(cb); later(snapItems); } }; },
    doc: function (path) {
      return {
        set: function (d) { rec(["set", path, clone(d)]); docs[path] = clone(d); later(function () { fire(path); }); return Promise.resolve(); },
        update: function (d) { rec(["update", path, clone(d)]); docs[path] = Object.assign({}, docs[path] || {}, clone(d)); later(function () { fire(path); }); return Promise.resolve(); },
        delete: function () { rec(["delete", path]); delete docs[path]; later(function () { fire(path); }); return Promise.resolve(); },
        onSnapshot: function (cb) { (docSubs[path] = docSubs[path] || []).push(cb); later(function () { fireDoc(path); }); },
        acquire: function (o) {
          var now = Date.now(), l = leases[path];
          if (window.__leaseBusy || (l && l.until > now && l.holder !== o.holder)) return Promise.resolve({ acquired: false, expiresAt: new Date(now + 1000).toISOString() });
          leases[path] = { holder: o.holder, until: now + (o.ttlMs || 30000) };
          return Promise.resolve({ acquired: true, holder: o.holder, expiresAt: new Date(leases[path].until).toISOString() });
        },
        get: function () { var d = clone(docs[path]); return Promise.resolve({ id: path.split("/").pop(), exists: d != null, data: function () { return d == null ? undefined : clone(d); }, metadata: { fromCache: false } }); }
      };
    }
  };
  docs = window.__seed();

  // ---- a fake `user` capability: you, and two teammates ----
  var ME = "u_me00000000000000000001", ANA = "u_ana0000000000000000001", BEN = "u_ben0000000000000000001";
  window.__people = { me: ME, ana: ANA, ben: BEN };
  var directory = {}; directory[ME] = "Kasper"; directory[ANA] = "Ana Lee"; directory[BEN] = "Ben Ortiz";
  window.__viewer = { id: ME, isOwner: true, canEdit: true };
  function profile(id) { return { id: id, name: directory[id] || "", avatarUrl: "data:,", color: "#888888", email: null, isMe: id === window.__viewer.id, guest: false }; }
  var user = {
    me: function () { var v = window.__viewer; return Promise.resolve({ id: v.id, name: directory[v.id] || "", avatarUrl: "data:,", color: "#888888", email: null, isOwner: v.isOwner, canEdit: v.canEdit }); },
    id: function () { return Promise.resolve(window.__viewer.id); },
    isOwner: function () { return Promise.resolve(window.__viewer.isOwner); },
    canEdit: function () { return Promise.resolve(window.__viewer.canEdit); },
    can: function () { return Promise.resolve(null); },
    profiles: function (ids) { var out = {}; [].concat(ids).forEach(function (id) { out[id] = profile(id); }); return Promise.resolve(out); },
    search: function (q) {
      q = String(q || "").toLowerCase();
      return Promise.resolve(Object.keys(directory).filter(function (id) { return !q || directory[id].toLowerCase().indexOf(q) >= 0; }).slice(0, 8).map(profile));
    }
  };
  // ---- a fake `assets` capability ----
  window.__assets = { uploads: [], deletes: [], failNext: null };
  var assets = {
    upload: function (blob, opts) {
      var fail = window.__assets.failNext; window.__assets.failNext = null;
      if (fail) return Promise.reject({ code: fail, message: fail });
      var id = ""; for (var i = 0; i < 32; i++) id += "0123456789abcdef"[Math.floor(Math.random() * 16)];
      window.__assets.uploads.push({ id: id, type: (opts && opts.type) || blob.type, size: blob.size });
      return Promise.resolve({ id: id, url: "/_blob/" + id, sizeBytes: blob.size, contentType: (opts && opts.type) || blob.type });
    },
    delete: function (ref) { window.__assets.deletes.push(ref); return Promise.resolve({ deleted: true }); },
    list: function () { return Promise.resolve({ assets: [], usage: { files: 0, bytes: 0, maxFiles: 1000, maxBytes: 1e9 } }); }
  };
  window.claude = { use: function (name) { return Promise.resolve(name === "db" ? db : name === "user" ? user : name === "assets" ? assets : null); } };
})();
