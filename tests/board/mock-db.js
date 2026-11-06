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
(function () {
  "use strict";
  var docs = {}, itemSubs = [], docSubs = {};
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
  window.__seed = function () {
    return {
      "items/1": { name: "Alpha task", priority: "urgent", value: 4, effort: "S", notes: "note one", status: "todo", order: 1, addedAt: "2026-11-01", link: "javascript:alert(1)" },
      "items/4": { name: "Delta urgent", priority: "urgent", value: 3, effort: "M", notes: "", status: "todo", order: 2, addedAt: "2026-11-04", color: "red;background:url(x)" },
      "items/5": { name: "Echo urgent", priority: "urgent", value: 1, effort: "XL", notes: "", status: "todo", order: 3, addedAt: "2026-11-05" },
      "items/2": { name: "Beta task", priority: "important", value: 2, effort: "M", notes: "", status: "todo", order: 1, addedAt: "2026-11-02", link: "https://github.com/a/b/tree/%E0%A4" },
      "items/3": { name: "Gamma done", priority: "nice", value: 3, effort: "L", notes: "", status: "done", order: 1, addedAt: "2026-10-01", finishedAt: "2026-11-03" }
    };
  };
  window.__reset = function (next) {
    docs = clone(next || window.__seed());
    window.__writes.length = 0;
    snapItems();
    Object.keys(docSubs).forEach(fireDoc);
  };
  window.__remote = function (path, d) { docs[path] = Object.assign({}, docs[path] || {}, clone(d)); fire(path); };

  var db = {
    collection: function () { return { onSnapshot: function (cb) { itemSubs.push(cb); later(snapItems); } }; },
    doc: function (path) {
      return {
        set: function (d) { window.__writes.push(["set", path, clone(d)]); docs[path] = clone(d); later(function () { fire(path); }); return Promise.resolve(); },
        update: function (d) { window.__writes.push(["update", path, clone(d)]); docs[path] = Object.assign({}, docs[path] || {}, clone(d)); later(function () { fire(path); }); return Promise.resolve(); },
        delete: function () { window.__writes.push(["delete", path]); delete docs[path]; later(function () { fire(path); }); return Promise.resolve(); },
        onSnapshot: function (cb) { (docSubs[path] = docSubs[path] || []).push(cb); later(function () { fireDoc(path); }); }
      };
    }
  };
  docs = window.__seed();
  window.claude = { use: function (name) { return Promise.resolve(name === "db" ? db : null); } };
})();
