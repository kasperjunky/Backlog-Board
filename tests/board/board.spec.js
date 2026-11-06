// Behaviour tests for board.html, run in a real (headless) browser against the
// in-memory db in mock-db.js. Results are written as JSON into
// <pre id="test-results"> for scripts/test-board.mjs to read.
(async function () {
  "use strict";
  var results = [];
  var tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms == null ? 30 : ms); }); };
  function eq(actual, expected, what) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error((what ? what + ": " : "") + "expected " + e + ", got " + a);
  }
  function ok(cond, what) { if (!cond) throw new Error(what || "assertion failed"); }
  async function test(name, fn) {
    try { window.__reset(); await tick(); await fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, error: String((e && e.message) || e) }); }
  }
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function lane(col) { return $$('[data-list="' + col + '"] .card .name').map(function (n) { return n.textContent; }); }
  function card(id) { return $('.card[data-id="' + id + '"]'); }
  function key(el, k, opts) { el.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {}))); }
  function search(q) { var s = $("#searchInput"); s.value = q; s.dispatchEvent(new Event("input")); }
  async function openMover(id) { var b = $(".movebtn", card(id)); if (b.getAttribute("aria-expanded") !== "true") b.click(); await tick(); }
  async function closeMover(id) { var c = card(id); var b = c && $(".movebtn", c); if (b && b.getAttribute("aria-expanded") === "true") b.click(); await tick(); }

  await tick(150); // first load

  // ---- rendering and safety ----
  await test("renders lanes in order and the archive", async function () {
    eq(lane("urgent"), ["Alpha task", "Delta urgent", "Echo urgent"], "urgent");
    eq(lane("important"), ["Beta task"], "important");
    eq($$(".arc-item .nm").map(function (n) { return n.textContent; }), ["Gamma done"], "archive");
  });
  await test("javascript: links are never rendered as links", async function () {
    eq($$(".linkchip", card("1")).length, 0, "link chips on card 1");
    ok(!$$("a").some(function (a) { return /^\s*javascript:/i.test(a.getAttribute("href") || ""); }), "a javascript: href exists");
  });
  await test("a malformed %-encoded link does not break rendering", async function () {
    var chip = $(".linkchip", card("2"));
    ok(chip, "card 2 has its link chip");
    eq(chip.textContent, "🔗 %E0%A4");
  });
  await test("an invalid card color is ignored", async function () {
    var st = card("4").getAttribute("style") || "";
    ok(st.indexOf("url(") < 0 && st.indexOf("red;") < 0, "style was: " + st);
  });
  await test("saving a javascript: link is refused", async function () {
    $(".linkbtn", card("1")).click(); await tick();
    var box = $(".linkedit", card("1")); var inp = $("input", box);
    inp.value = "javascript:alert(1)"; $(".le-btn.primary", box).click(); await tick();
    ok(!$(".le-err", box).hidden, "error message shown");
    eq(window.__writes.filter(function (w) { return w[2] && "link" in w[2]; }).length, 0, "link writes");
  });

  // ---- moving without dragging ----
  await test("Move row: Down reorders the lane and saves only what changed", async function () {
    await openMover("1");
    $('[data-act="down"]', card("1")).click(); await tick();
    eq(lane("urgent"), ["Delta urgent", "Alpha task", "Echo urgent"]);
    var w = window.__writes.map(function (x) { return x[1] + ":" + JSON.stringify(x[2]); }).sort();
    eq(w, ['items/1:{"order":2}', 'items/4:{"order":1}'], "writes");
    eq(document.activeElement && document.activeElement.dataset.act, "down", "focus kept on Down");
    await closeMover("1");
  });
  await test("Alt+ArrowDown / Alt+ArrowUp move the focused card", async function () {
    var b = $(".movebtn", card("1")); b.focus();
    key(b, "ArrowDown", { altKey: true }); await tick();
    eq(lane("urgent"), ["Delta urgent", "Alpha task", "Echo urgent"], "after Alt+Down");
    key(document.activeElement, "ArrowUp", { altKey: true }); await tick();
    eq(lane("urgent"), ["Alpha task", "Delta urgent", "Echo urgent"], "after Alt+Up");
    ok(/Moved “Alpha task” to position 1 of 3 in Urgent/.test($("#liveRegion").textContent), "announced: " + $("#liveRegion").textContent);
  });
  await test("Move row: moving to another lane", async function () {
    await openMover("1");
    $('[data-act="lane-important"]', card("1")).click(); await tick();
    eq(lane("urgent"), ["Delta urgent", "Echo urgent"], "urgent");
    eq(lane("important"), ["Beta task", "Alpha task"], "important");
    await closeMover("1");
  });
  await test("moving is disabled while a filter is on", async function () {
    await openMover("1");
    search("alpha"); await tick();
    ok($$(".mover .mv", card("1")).every(function (b) { return b.disabled; }), "all move buttons disabled");
    ok($(".mv-note", card("1")), "explains why");
    search(""); await tick(); await closeMover("1");
  });

  // ---- edits, remote updates, drag ----
  await test("a remote update waits while a card field is being edited", async function () {
    var why = $(".why", card("1")); why.focus(); why.textContent = "half-typed";
    window.__remote("items/2", { name: "Beta renamed" }); await tick();
    eq($(".name", card("2")).textContent, "Beta task", "deferred while editing");
    eq($(".why", card("1")).textContent, "half-typed", "typing kept");
    why.blur(); await tick(100);
    eq($(".name", card("2")).textContent, "Beta renamed", "applied after editing");
    ok(window.__writes.some(function (w) { return w[1] === "items/1" && w[2] && w[2].notes === "half-typed"; }), "note saved");
  });
  await test("keyboard focus survives a remote update", async function () {
    var b = $(".colorbtn", card("5")); b.focus();
    window.__remote("items/2", { name: "Beta again" }); await tick();
    ok(document.activeElement && document.activeElement.classList.contains("colorbtn") && document.activeElement.closest(".card").dataset.id === "5", "focus moved to " + (document.activeElement && document.activeElement.className));
  });
  await test("a snapshot arriving mid-drag is applied on drop", async function () {
    var c1 = card("1");
    c1.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() }));
    window.__remote("items/2", { status: "doing", name: "Beta during drag" }); await tick();
    var imp = $('[data-list="important"]'); imp.insertBefore(c1, imp.firstChild);
    c1.dispatchEvent(new DragEvent("dragend", { bubbles: true })); await tick();
    eq($(".name", card("2")).textContent, "Beta during drag", "queued update applied");
    eq(lane("important")[0], "Alpha task", "drop position kept");
  });

  // ---- archive, adders, controls ----
  await test("deleting from the archive needs a second click", async function () {
    $("#archive").open = true;
    $(".arc-item .iconbtn.danger").click(); await tick();
    eq(window.__writes.length, 0, "no delete yet");
    $(".arc-item .confirm button:not(.yes)").click(); await tick();
    eq($$(".arc-item").length, 1, "kept");
    $(".arc-item .iconbtn.danger").click(); $(".arc-item .confirm .yes").click(); await tick();
    eq($$(".arc-item").length, 0, "deleted");
    eq(window.__writes, [["delete", "items/3"]]);
  });
  await test("the + by a lane name opens an input that adds cards", async function () {
    $('[data-add-open="nice"]').click(); await tick();
    var inp = $('[data-add="nice"]'); ok(!inp.parentElement.hidden, "input open");
    inp.value = "From the plus"; key(inp, "Enter"); await tick();
    eq(lane("nice"), ["From the plus"]);
    ok(!inp.parentElement.hidden, "stays open for the next card");
    key(inp, "Escape"); await tick();
    ok(inp.parentElement.hidden, "Esc closes it");
  });
  await test("controls collapse, remember the choice, and flag active filters", async function () {
    var t = $("#controlsToggle");
    t.click(); await tick();
    ok($(".wrap").classList.contains("compact"), "collapsed");
    var stored = null; try { stored = localStorage.getItem("backlog.controlsCollapsed"); } catch (e) { stored = "unavailable"; }
    ok(stored === "1" || stored === "unavailable", "stored: " + stored);
    t.click(); search("alpha"); t.click(); await tick();
    ok(/filters on/.test(t.textContent), "label: " + t.textContent);
    t.click(); search(""); await tick();
    ok(!$(".wrap").classList.contains("compact"), "expanded again");
  });

  // ---- accessibility ----
  await test("every card and archive button has an accessible name", async function () {
    var bad = $$(".card button, .arc-item button").filter(function (b) {
      return !(b.getAttribute("aria-label") || b.textContent.replace(/[▾▸⇅✓✕↺🔗]/g, "").trim());
    });
    eq(bad.map(function (b) { return b.className; }), [], "unnamed buttons");
  });
  await test("value dots are at least 24x24", async function () {
    var r = $(".dots .d").getBoundingClientRect();
    ok(r.width >= 24 && r.height >= 24, "dot target " + r.width + "x" + r.height);
  });

  var pre = document.createElement("pre"); pre.id = "test-results"; pre.hidden = true;
  pre.textContent = JSON.stringify(results);
  document.body.appendChild(pre);
})();
