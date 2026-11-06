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
    eq($$(".arc-item .nm").map(function (n) { return n.textContent; }), ["Gamma done", "Zeta old done"], "archive (newest first)");
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
    eq($$(".arc-item").length, 2, "kept");
    $(".arc-item .iconbtn.danger").click(); $(".arc-item .confirm .yes").click(); await tick();
    eq($$(".arc-item").length, 1, "deleted");
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

  // ---- due dates ----
  await test("an overdue card shows a red chip and counts in the Overdue stat", async function () {
    var chip = $(".duechip", card("1"));
    ok(chip && chip.classList.contains("over"), "overdue chip on card 1");
    ok(/^📅 Overdue \d+d$/.test(chip.textContent), "chip text: " + chip.textContent);
    var far = $(".duechip", card("2"));
    ok(far && !far.classList.contains("over") && !far.classList.contains("soon") && /^📅 Due /.test(far.textContent), "future chip: " + (far && far.className + " " + far.textContent));
    var tile = $$(".stat").filter(function (s) { return /Overdue/i.test(s.textContent); })[0];
    ok(tile, "Overdue tile exists");
    eq($(".statn", tile).textContent, "1", "overdue count");
    ok($(".statn", tile).classList.contains("warn"), "overdue tile warns");
  });
  await test("setting and removing a due date", async function () {
    $(".dueadd", card("4")).click(); await tick();
    var box = $(".dueedit", card("4")); var inp = $("input", box);
    inp.value = "2030-05-06"; $("button.primary", box).click(); await tick();
    ok(window.__writes.some(function (w) { return w[1] === "items/4" && w[2] && w[2].due === "2030-05-06"; }), "due saved");
    ok($(".duechip", card("4")), "chip shown after saving");
    $(".duechip", card("1")).click(); await tick();
    var rm = $$(".dueedit button", card("1")).filter(function (b) { return b.textContent === "Remove"; })[0];
    ok(rm, "Remove button for an existing due date"); rm.click(); await tick();
    ok(window.__writes.some(function (w) { return w[1] === "items/1" && w[2] && w[2].due === ""; }), "due removed");
    ok($(".dueadd", card("1")), "back to the set-date button");
  });
  await test("an impossible due date from the db is ignored", async function () {
    window.__remote("items/5", { due: "2026-02-31" }); await tick();
    ok(!$(".duechip", card("5")) && $(".dueadd", card("5")), "no chip for 2026-02-31");
  });

  // ---- remembered view, archive cleanup ----
  await test("search, filters and sort are remembered in this browser", async function () {
    var stored = function () { try { return JSON.parse(localStorage.getItem("backlog.view") || "null"); } catch (e) { return "unavailable"; } };
    if (stored() === "unavailable") return; // storage blocked: nothing to remember
    $('#effortFilter .fchip[data-effort="S"]').click(); $("#sortToggle").click(); search("alp"); await tick();
    var v = stored();
    eq([v.efforts, v.sort, v.q], [["S"], "score", "alp"], "saved view");
    $("#clearFilters").click(); $("#sortToggle").click(); await tick();
    v = stored();
    eq([v.efforts, v.statuses, v.sort, v.q], [[], [], "manual", ""], "cleared view");
  });
  await test("the archive offers to remove cards done more than 30 days ago", async function () {
    $("#archive").open = true;
    var tools = $("#arcTools");
    ok(!tools.hidden, "tools shown");
    var b = $(".arc-clean", tools); ok(b && /Remove 1 card done more than 30 days ago/.test(b.textContent), "button: " + (b && b.textContent));
    b.click(); await tick();
    eq(window.__writes.length, 0, "nothing deleted before confirming");
    $(".arc-keep", tools).click(); await tick();
    ok($(".arc-clean", tools), "Keep goes back");
    $(".arc-clean", tools).click(); await tick(); $("button.yes", tools).click(); await tick();
    eq(window.__writes, [["delete", "items/6"]], "only the old card");
    eq($$(".arc-item .nm").map(function (n) { return n.textContent; }), ["Gamma done"], "recent one kept");
    ok(tools.hidden, "tools hide when nothing qualifies");
  });

  // ---- themes ----
  var rootVar = function (t) { return document.documentElement.style.getPropertyValue("--" + t).trim(); };
  async function openTheme() { var m = $("#themeMenu"); if (m.hidden) $("#themeBtn").click(); await tick(); return m; }
  async function pick(sel) { var m = await openTheme(); $(sel, m).click(); await tick(); }
  async function themeReset() { await pick('[data-palette="warm"]'); await pick('[data-mode="auto"]'); $("#themeBtn").click(); await tick(); }

  await test("the theme menu lists six palettes, Warm by default", async function () {
    var m = await openTheme();
    eq($$(".th-opt", m).map(function (b) { return b.dataset.palette; }), ["warm", "ocean", "forest", "grape", "mono", "contrast"]);
    eq($('[aria-checked="true"]', m).dataset.palette, "warm", "checked");
    eq(rootVar("accent"), "", "Warm uses the stylesheet's own colors");
    eq($('[data-mode="auto"]', m).getAttribute("aria-pressed"), "true", "mode");
    $("#themeBtn").click(); await tick();
  });
  await test("picking a palette recolors the board and saves it on the board", async function () {
    await pick('[data-palette="ocean"]');
    var dark = matchMedia("(prefers-color-scheme: dark)").matches;
    eq(rootVar("accent"), dark ? "#5cc3f0" : "#0b6690", "ocean accent");
    eq(rootVar("urgent"), dark ? "#f28f80" : "#c8402f", "ocean urgent");
    var w = window.__writes.filter(function (x) { return x[1] === "meta/theme"; });
    eq(w.length, 1, "one write"); eq([w[0][0], w[0][2].palette, w[0][2].mode], ["set", "ocean", "auto"]);
    var cached = null; try { cached = JSON.parse(localStorage.getItem("backlog.theme")); } catch (e) { cached = "unavailable"; }
    ok(cached === "unavailable" || (cached && cached.palette === "ocean"), "cached: " + JSON.stringify(cached));
    eq($('#themeMenu [aria-checked="true"]').dataset.palette, "ocean", "menu shows the choice");
    await themeReset();
  });
  await test("Light and Dark override the system; Auto follows it", async function () {
    await pick('[data-palette="forest"]');
    await pick('[data-mode="dark"]');
    var root = document.documentElement;
    ok(root.classList.contains("mode-dark") && !root.classList.contains("mode-light"), "dark class");
    eq(rootVar("accent"), "#86cf88", "forest dark accent");
    eq(getComputedStyle(root).getPropertyValue("--bg").trim(), "#15120d", "dark background");
    await pick('[data-mode="light"]');
    ok(root.classList.contains("mode-light") && !root.classList.contains("mode-dark"), "light class");
    eq(rootVar("accent"), "#2e6b30", "forest light accent");
    eq(getComputedStyle(root).getPropertyValue("--bg").trim(), "#f6f4ee", "light background");
    await pick('[data-mode="auto"]');
    ok(!root.classList.contains("mode-light") && !root.classList.contains("mode-dark"), "no override on Auto");
    await themeReset();
  });
  await test("a theme chosen on another device is applied; a bad one is ignored", async function () {
    window.__remote("meta/theme", { palette: "grape", mode: "light" }); await tick();
    eq(rootVar("accent"), "#7339ad", "grape light accent");
    ok(document.documentElement.classList.contains("mode-light"), "light mode from the board");
    window.__remote("meta/theme", { palette: "neon<script>", mode: "sideways" }); await tick();
    eq(rootVar("accent"), "", "unknown palette falls back to Warm");
    ok(!document.documentElement.classList.contains("mode-light"), "unknown mode falls back to Auto");
    await themeReset();
  });
  await test("text on Urgent buttons uses the palette's own readable color", async function () {
    await pick('[data-palette="mono"]'); await pick('[data-mode="dark"]'); $("#themeBtn").click(); await tick();
    $("#archive").open = true;
    $(".arc-item .iconbtn.danger").click(); await tick();
    var yes = $(".arc-item .confirm .yes");
    eq(getComputedStyle(yes).color, "rgb(17, 17, 17)", "dark text on Mono's light urgent");
    $(".arc-item .confirm button:not(.yes)").click(); await tick();
    await themeReset();
  });

  // ---- custom background / card colors ----
  async function setColor(key, hex) {
    var m = await openTheme(); var inp = $('input[data-custom="' + key + '"]', m);
    inp.value = hex; inp.dispatchEvent(new Event("input")); inp.dispatchEvent(new Event("change")); await tick();
  }
  async function resetColor(key) {
    var m = await openTheme(); var b = $('input[data-custom="' + key + '"]', m).parentElement.querySelector(".th-reset");
    if (!b.disabled) { b.click(); await tick(); }
  }
  await test("a custom background recolors the page and lane panels, saved per mode", async function () {
    await pick('[data-mode="dark"]');
    await setColor("bg", "#0d1b2a");
    eq(rootVar("bg"), "#0d1b2a", "page background");
    ok(/color-mix\(in srgb, #0d1b2a/.test(rootVar("surface-2")), "lane panels shaded from it: " + rootVar("surface-2"));
    ok(/color-mix\(in srgb, #0d1b2a/.test(rootVar("surface")), "tiles, inputs and menus follow it: " + rootVar("surface"));
    var cardSwatch = $('#themeMenu input[data-custom="card"]').value;
    ok(/^#[0-9a-f]{6}$/.test(cardSwatch) && cardSwatch !== "#201c16", "Cards swatch shows the painted color, not the old brown: " + cardSwatch);
    var w = window.__writes.filter(function (x) { return x[1] === "meta/theme"; }).pop();
    eq(w[2].custom, { light: {}, dark: { bg: "#0d1b2a" } }, "saved for dark mode only");
    eq(getComputedStyle(document.body).backgroundColor, "rgb(13, 27, 42)", "body painted");
    await pick('[data-mode="light"]');
    eq(rootVar("bg"), "", "light mode keeps its own background");
    await pick('[data-mode="dark"]'); await resetColor("bg");
    eq(rootVar("bg"), "", "Reset removes it");
    await themeReset();
  });
  await test("a custom card color recolors every card with just a light lane tint", async function () {
    await pick('[data-mode="light"]');
    await setColor("card", "#fff7d6");
    eq(rootVar("card"), "#fff7d6", "card token");
    eq(rootVar("card-tint"), "12%", "lighter lane tint");
    var bg = getComputedStyle(card("4")).backgroundColor;
    ok(bg !== "" && bg !== "rgba(0, 0, 0, 0)", "card painted: " + bg);
    var arc = getComputedStyle($(".arc-item")).backgroundColor;
    eq(arc, "rgb(255, 247, 214)", "archive cards use it too");
    await resetColor("card");
    eq(rootVar("card"), "", "Reset removes it");
    await themeReset();
  });
  await test("a hard-to-read custom color shows a warning", async function () {
    await pick('[data-mode="dark"]');
    var m = await openTheme(); var inp = $('input[data-custom="bg"]', m);
    inp.value = "#f4f4f4"; inp.dispatchEvent(new Event("input")); await tick();
    var warn = inp.parentElement.nextElementSibling;
    ok(warn.classList.contains("th-warn") && !warn.hidden, "warning shown");
    ok(/hard to read/.test(warn.textContent), "says why: " + warn.textContent);
    inp.value = "#101820"; inp.dispatchEvent(new Event("input")); await tick();
    ok(warn.hidden, "dark color: no warning");
    inp.dispatchEvent(new Event("change")); await tick();
    await resetColor("bg"); await themeReset();
  });
  await test("custom colors from the board are applied; invalid ones are ignored", async function () {
    window.__remote("meta/theme", { palette: "warm", mode: "light", custom: { light: { bg: "#eef4ff", card: "url(x)" }, dark: { bg: "red" } } }); await tick();
    eq(rootVar("bg"), "#eef4ff", "valid bg applied");
    eq(rootVar("card"), "", "invalid card ignored");
    window.__remote("meta/theme", { palette: "warm", mode: "auto", custom: null }); await tick();
    eq(rootVar("bg"), "", "cleared");
    await themeReset();
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
