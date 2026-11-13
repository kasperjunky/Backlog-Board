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
  await test("oversized card text written through the API renders clipped", async function () {
    var big = new Array(6000).join("x");
    var subs = []; for (var i = 0; i < 150; i++) subs.push({ text: "sub " + big, done: false });
    window.__remote("items/5", { name: big, notes: big, result: big, subtasks: subs }); await tick(60);
    var c = card("5");
    ok(c, "card 5 still renders");
    eq($(".name", c).textContent.length, 200, "name clipped to 200");
    eq($(".why", c).textContent.length, 2000, "notes clipped to 2000");
    eq($$(".ck-row", c).length, 100, "subtasks capped at 100");
    eq($(".ck-row .ck-t", c).textContent.length, 200, "subtask text clipped to 200");
    var cms = []; for (var j = 0; j < 150; j++) cms.push({ by: "nobody", at: 12, text: "c" + j + " " + big });
    window.__remote("items/5", { comments: cms }); await tick(60);
    $(".cmtbtn", card("5")).click(); await tick();
    eq($$(".cm", card("5")).length, 100, "comments capped at 100 (newest kept)");
    ok(/^c50 /.test($(".cm .cm-t", card("5")).textContent), "the oldest 50 were dropped: " + $(".cm .cm-t", card("5")).textContent.slice(0, 12));
    eq($(".cm .cm-t", card("5")).textContent.length, 1000, "comment text clipped to 1000");
    eq($(".cm .cm-h b", card("5")).textContent, "Someone", "an invalid author id shows as Someone");
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
  await test("deleting from the archive is immediate, and Undo puts the card back", async function () {
    $("#archive").open = true;
    $(".arc-item .iconbtn.danger").click(); await tick();
    eq($$(".arc-item").length, 1, "gone at once");
    eq(window.__writes, [["delete", "items/3"]], "the doc is deleted right away");
    var toast = $("#toast");
    ok(!toast.hidden && /Deleted “Gamma done”/.test(toast.textContent), "toast: " + toast.textContent);
    eq(document.activeElement && document.activeElement.className, "tundo", "focus lands on Undo");
    $(".tundo", toast).click(); await tick();
    eq($$(".arc-item").length, 2, "restored");
    ok(toast.hidden, "toast closed");
    var back = window.__writes.filter(function (w) { return w[0] === "set" && w[1] === "items/3"; })[0];
    ok(back && back[2].name === "Gamma done" && back[2].status === "done" && back[2].finishedAt === "2026-11-03", "written back as it was: " + JSON.stringify(back && back[2]));
    eq($$(".arc-item .nm").map(function (n) { return n.textContent; }), ["Gamma done", "Zeta old done"], "archive order kept");
  });
  await test("deletes stack into one toast, which goes away when the Undo window ends", async function () {
    $(".iconbtn.danger", card("5")).click(); await tick();
    ok(!card("5"), "card 5 gone");
    $(".iconbtn.danger", card("4")).click(); await tick();
    var toast = $("#toast");
    ok(/Deleted 2 cards/.test(toast.textContent), "stacked: " + toast.textContent);
    eq(window.__writes, [["delete", "items/5"], ["delete", "items/4"]], "two deletes, nothing else");
    await tick(window.__undoMs + 150);
    ok(toast.hidden, "toast gone after the window");
    eq(lane("urgent"), ["Alpha task"], "cards stay deleted");
    eq(window.__writes.length, 2, "no further writes");
  });
  await test("Undo after stacked deletes restores every card, and Escape dismisses the toast", async function () {
    $(".iconbtn.danger", card("5")).click(); await tick();
    $(".iconbtn.danger", card("4")).click(); await tick();
    $(".tundo", $("#toast")).click(); await tick();
    eq(lane("urgent"), ["Alpha task", "Delta urgent", "Echo urgent"], "both back in place");
    eq(window.__writes.filter(function (w) { return w[0] === "set"; }).map(function (w) { return w[1]; }).sort(), ["items/4", "items/5"], "both written back");
    $(".iconbtn.danger", card("5")).click(); await tick();
    key(document.activeElement, "Escape");
    ok($("#toast").hidden, "Escape on the toast dismisses it");
    ok(!card("5"), "the delete stands");
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
    eq(getComputedStyle(root).getPropertyValue("--bg").trim(), "#1b1f22", "dark background");
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
    $(".arc-clean", $("#arcTools")).click(); await tick();
    var yes = $("#arcTools button.yes");
    eq(getComputedStyle(yes).color, "rgb(17, 17, 17)", "dark text on Mono's light urgent");
    $(".arc-keep", $("#arcTools")).click(); await tick();
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

  // ---- team boards ----
  var P = window.__people;
  function teamCard(id, name, extra) {
    window.__remote("items/" + id, Object.assign({ name: name, priority: "nice", value: 3, effort: "M", notes: "", status: "todo", order: 9, addedAt: "2026-11-06" }, extra || {}));
  }
  await test("the board saves the viewer's id privately so Claude can attribute cards", async function () {
    ok(window.__allWrites.some(function (w) { return w[0] === "set" && w[1] === "data/users/" + P.me + "/whoami" && w[2].id === P.me; }), "whoami written");
  });
  await test("a solo board shows no team controls", async function () {
    eq($$(".assignadd, .assignchip, .byline").length, 0, "no people controls");
    ok($("#mineFilter").hidden, "Mine filter hidden");
  });
  await test("a teammate's card shows who added it and turns on team controls", async function () {
    teamCard("7", "Ana's task", { createdBy: P.ana }); await tick(60);
    var by = $(".byline", card("7"));
    ok(by && by.textContent === "by Ana Lee", "byline: " + (by && by.textContent));
    ok($(".assignadd", card("1")), "assign button on every card");
    ok(!$("#mineFilter").hidden, "Mine filter shown");
    eq($$(".byline", card("1")).length, 0, "no byline on my own cards");
  });
  await test("assigning a card to yourself, then to a teammate found by name", async function () {
    teamCard("7", "Ana's task", { createdBy: P.ana }); await tick(60);
    $(".assignadd", card("7")).click(); await tick();
    var me = $$(".assignbox .as-list button", card("7")).filter(function (b) { return b.textContent === "Me"; })[0];
    ok(me, "Me option"); me.click(); await tick();
    ok(window.__writes.some(function (w) { return w[1] === "items/7" && w[2] && w[2].assignee === P.me; }), "assigned to me");
    var chip = $(".assignchip", card("7"));
    ok(chip && chip.classList.contains("mine") && chip.textContent === "👤 You", "chip: " + (chip && chip.textContent));
    chip.click(); await tick();
    var inp = $(".assignbox input", card("7")); inp.value = "ben"; inp.dispatchEvent(new Event("input")); await tick();
    var ben = $$(".assignbox .as-list button", card("7")).filter(function (b) { return b.textContent === "Ben Ortiz"; })[0];
    ok(ben, "search found Ben"); ben.click(); await tick();
    ok(window.__writes.some(function (w) { return w[1] === "items/7" && w[2] && w[2].assignee === P.ben; }), "assigned to Ben");
    eq($(".assignchip", card("7")).textContent, "👤 Ben Ortiz");
  });
  await test("Mine shows only cards assigned to you", async function () {
    teamCard("7", "Ana's task", { createdBy: P.ana, assignee: P.me });
    teamCard("8", "Ben's task", { createdBy: P.ana, assignee: P.ben }); await tick(60);
    $("#mineFilter").click(); await tick();
    eq($$(".card .name").map(function (n) { return n.textContent; }), ["Ana's task"], "only mine");
    $("#clearFilters").click(); await tick();
    ok(!$("#mineFilter").classList.contains("active"), "Clear filters turns Mine off");
  });
  await test("Work on this saves a private pick and assigns the card to you", async function () {
    $(".workbtn", card("2")).click(); await tick();
    ok(window.__writes.some(function (w) { return w[0] === "set" && w[1] === "data/users/" + P.me + "/handoff" && w[2].itemId === "2"; }), "personal pick");
    ok(!window.__writes.some(function (w) { return w[1] === "handoff/current"; }), "shared slot untouched");
    ok(window.__writes.some(function (w) { return w[1] === "items/2" && w[2] && w[2].assignee === P.me; }), "assigned to me");
    ok($(".pickedbadge", card("2")), "picked badge");
    $(".pickedbadge .clr", card("2")).click(); await tick();
    ok(window.__writes.some(function (w) { return w[0] === "delete" && w[1] === "data/users/" + P.me + "/handoff"; }), "Clear removes my pick");
  });
  await test("cards added on the board record who added them", async function () {
    $('[data-add-open="important"]').click(); await tick();
    var inp = $('[data-add="important"]'); inp.value = "Board-made card"; key(inp, "Enter"); await tick();
    var w = window.__writes.filter(function (x) { return x[0] === "set" && /^items\/b/.test(x[1]); })[0];
    ok(w && w[2].createdBy === P.me, "createdBy: " + (w && w[2].createdBy));
    key(inp, "Escape"); await tick();
  });
  await test("a board marked as a team board shows team controls from the start", async function () {
    window.__remote("meta/team", { enabled: true }); await tick();
    ok($(".assignadd", card("1")) && !$("#mineFilter").hidden, "team controls on");
    window.__remote("meta/team", { enabled: false }); await tick();
    eq($$(".assignadd").length, 0, "off again");
  });

  // ---- comments ----
  await test("a comment thread: post, see who wrote what, remove", async function () {
    var P2 = window.__people;
    eq($(".cmtbtn", card("1")).getAttribute("aria-label"), "Comments (0)", "empty count");
    $(".cmtbtn", card("1")).click(); await tick();
    var th = $(".thread", card("1")); ok(th, "thread opened");
    ok(/No comments yet/.test(th.textContent), "empty state");
    eq(document.activeElement && document.activeElement.getAttribute("aria-label"), "Add a comment", "focus in the input");
    var inp = $(".thread input", card("1")); inp.value = "  Blocked on the API change  https://example.com/x  ";
    key(inp, "Enter"); await tick();
    var w = window.__writes.filter(function (x) { return x[1] === "items/1" && x[2] && x[2].comments; }).pop();
    ok(w && w[2].comments.length === 1 && w[2].comments[0].by === P2.me && w[2].comments[0].text === "Blocked on the API change https://example.com/x" && /^\d{4}-\d{2}-\d{2}T/.test(w[2].comments[0].at), "written: " + JSON.stringify(w && w[2]));
    var cm = $(".cm", card("1")); ok(cm, "rendered");
    eq($(".cm-h b", cm).textContent, "You", "my own name");
    ok($(".cm-t a.rlink", cm) && $(".cm-t a.rlink", cm).getAttribute("href") === "https://example.com/x", "links in comments are clickable");
    eq($(".cmtbtn", card("1")).getAttribute("aria-label"), "Comments (1)", "count on the button");
    ok($(".thread input", card("1")), "input stays for the next comment");
    // a teammate's comment arrives (once you stop typing): named, and (as the owner) removable
    if (document.activeElement) document.activeElement.blur();
    window.__remote("items/1", { comments: w[2].comments.concat([{ by: P2.ana, at: "2026-11-12T09:00:00.000Z", text: "<b>I can take this</b>" }]) }); await tick(80);
    var rows = $$(".cm", card("1")); eq(rows.length, 2, "both shown");
    eq($(".cm-h b", rows[1]).textContent, "Ana Lee", "teammate named");
    eq($(".cm-t", rows[1]).textContent, "<b>I can take this</b>", "shown as text, never HTML");
    eq($$(".cm-t b", card("1")).length, 0, "no markup injected");
    $(".cm-x", rows[0]).click(); await tick();
    var w2 = window.__writes.filter(function (x) { return x[1] === "items/1" && x[2] && x[2].comments; }).pop();
    eq(w2[2].comments.map(function (c) { return c.text; }), ["<b>I can take this</b>"], "mine removed, Ana's kept");
    $(".cmtbtn", card("1")).click(); await tick();
    ok(!$(".thread", card("1")), "thread closes again");
  });
  await test("the Markdown export lists comments under the card", async function () {
    window.__remote("items/2", { comments: [{ by: window.__people.ana, at: "2026-11-12T09:00:00.000Z", text: "Needs the new API" }] }); await tick(80);
    $("#exportMd").click(); await tick(80);
    var ta = $(".exp-ta"); ok(ta, "the export fallback shows the Markdown");
    var md = ta.value;
    ok(/- 💬 Ana Lee \(2026-11-12\): Needs the new API/.test(md), "export line: " + md.split("\n").filter(function (l) { return /💬/.test(l); }).join(" | "));
    $$(".exp-btn").filter(function (b) { return b.textContent === "Close"; })[0].click(); await tick();
  });

  // ---- running numbers ----
  function label(id) { var c = card(id); return c ? $(".idtag", c).textContent : null; }
  await test("a card added on the board gets the next running number", async function () {
    $('[data-add-open="urgent"]').click(); await tick();
    var inp = $('[data-add="urgent"]'); inp.value = "Numbered card"; key(inp, "Enter"); await tick(80);
    key(inp, "Escape"); await tick();
    var w = window.__writes.filter(function (x) { return x[0] === "update" && x[2] && typeof x[2].num === "number"; })[0];
    ok(w, "a num was written");
    eq(w[2].num, 7, "next after the highest card (#6)");
    eq(window.__doc("counters/items").next, 8, "counter advanced");
    var id = w[1].split("/")[1];
    eq(label(id), "#7", "shown as #7, not its doc id");
  });
  await test("cards without a number are numbered oldest first", async function () {
    window.__remote("counters/items", { next: 40 });
    window.__remote("items/bOld", { name: "Older board card", priority: "nice", status: "todo", order: 5, addedAt: "2026-11-01" });
    window.__remote("items/bNew", { name: "Newer board card", priority: "nice", status: "todo", order: 6, addedAt: "2026-11-05" });
    await tick(120);
    eq([window.__doc("items/bOld").num, window.__doc("items/bNew").num], [40, 41]);
    eq([label("bOld"), label("bNew")], ["#40", "#41"]);
  });
  await test("two cards with the same number: the newer one is renumbered", async function () {
    window.__remote("counters/items", { next: 50 });
    window.__remote("items/bDup", { name: "Clashing card", priority: "nice", status: "todo", order: 7, addedAt: "2026-11-06", num: 2 });
    await tick(120);
    eq(window.__doc("items/2").num, undefined, "Claude's #2 keeps its number");
    eq(window.__doc("items/bDup").num, 50, "the clashing card got a fresh one");
  });
  await test("after #999 come #A1 … #A999, then #B1, and #AA1 after #Z999", async function () {
    var cases = [[999, "#999"], [1000, "#A1"], [1998, "#A999"], [1999, "#B1"], [26973, "#Z999"], [26974, "#AA1"]];
    cases.forEach(function (c, k) { window.__remote("items/n" + k, { name: "N" + k, priority: "nice", status: "todo", order: 20 + k, addedAt: "2026-11-01", num: c[0] }); });
    await tick(60);
    eq(cases.map(function (c, k) { return label("n" + k); }), cases.map(function (c) { return c[1]; }));
  });
  await test("while another board holds the counter, numbering waits and retries", async function () {
    window.__leaseBusy = true;
    window.__remote("items/bWait", { name: "Waiting card", priority: "nice", status: "todo", order: 9, addedAt: "2026-11-07" });
    await tick(100);
    ok(!window.__doc("items/bWait").num, "not numbered while the counter is busy");
    window.__leaseBusy = false;
    await tick(1500);
    ok(window.__doc("items/bWait").num > 0, "numbered once it's free");
  });

  // ---- images on cards ----
  function png(name, bytes) { return new File([new Uint8Array(bytes || 64)], name || "shot.png", { type: "image/png" }); }
  function imagesOf(id) { var d = window.__doc("items/" + id); return (d && d.images) || []; }
  // click 🖼 and "choose" files in the picker it opens
  async function pickFiles(cardId, files) {
    var orig = HTMLInputElement.prototype.click, picker = null;
    HTMLInputElement.prototype.click = function () { if (this.type === "file") picker = this; else orig.call(this); };
    try { $(".imgbtn", card(cardId)).click(); } finally { HTMLInputElement.prototype.click = orig; }
    ok(picker, "a file picker opened");
    ok(/image\/png/.test(picker.accept) && picker.multiple, "accepts images, several at once");
    var dt = new DataTransfer(); files.forEach(function (f) { dt.items.add(f); });
    picker.files = dt.files; picker.dispatchEvent(new Event("change")); await tick(80);
  }
  await test("adding an image saves its id on the card and shows a thumbnail", async function () {
    await pickFiles("1", [png("mockup.png")]);
    eq(window.__assets.uploads.length, 1, "one upload");
    eq(window.__assets.uploads[0].type, "image/png", "type passed explicitly");
    var imgs = imagesOf("1"); eq(imgs.length, 1, "saved on the card");
    var thumb = $(".imgstrip img", card("1"));
    ok(thumb && thumb.getAttribute("src") === "/_blob/" + imgs[0].id, "thumbnail from the stored id: " + (thumb && thumb.getAttribute("src")));
  });
  await test("wrong file types and oversized images are refused before uploading", async function () {
    await pickFiles("4", [new File(["hello"], "notes.txt", { type: "text/plain" })]);
    ok(/Only PNG, JPEG, GIF or WebP/.test($(".img-msg", card("4")).textContent), "type message");
    await pickFiles("4", [png("huge.png", 10 * 1024 * 1024 + 1)]);
    ok(/too big/.test($(".img-msg", card("4")).textContent), "size message");
    eq(window.__assets.uploads.length, 0, "nothing uploaded");
  });
  await test("an upload the store refuses shows why", async function () {
    window.__assets.failNext = "quota_or_state";
    await pickFiles("4", [png()]);
    ok(/storage is full/.test($(".img-msg", card("4")).textContent), $(".img-msg", card("4")).textContent);
    eq(imagesOf("4").length, 0);
  });
  await test("dropping an image on a card adds it", async function () {
    var dt = new DataTransfer(); dt.items.add(png("dropped.png"));
    var target = $(".why", card("5"));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    ok(card("5").classList.contains("img-drop"), "drop highlight");
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt })); await tick(80);
    eq(imagesOf("5").length, 1, "added by drop");
  });
  await test("pasting an image while editing a card adds it; pasting text does not", async function () {
    var why = $(".why", card("2")); why.focus();
    var dt = new DataTransfer(); dt.items.add(png("pasted.png"));
    why.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt })); await tick(80);
    eq(imagesOf("2").length, 1, "image pasted");
    var t = new DataTransfer(); t.setData("text/plain", "just words");
    var ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: t });
    $(".why", card("2")).dispatchEvent(ev); await tick(40);
    eq(window.__assets.uploads.length, 1, "text paste uploads nothing");
    ok(!ev.defaultPrevented, "text paste left to the editor");
    if (document.activeElement) document.activeElement.blur(); await tick(60);
  });
  await test("removing an image asks first, then deletes it", async function () {
    await pickFiles("1", [png()]); var id = imagesOf("1")[0].id;
    $(".img-x", card("1")).click(); await tick();
    $$(".img-ask button", card("1")).filter(function (b) { return b.textContent === "Keep"; })[0].click(); await tick();
    eq(imagesOf("1").length, 1, "Keep keeps it");
    $(".img-x", card("1")).click(); await tick();
    $(".img-ask .yes", card("1")).click(); await tick(60);
    eq(imagesOf("1").length, 0, "removed from the card");
    eq(window.__assets.deletes, [id], "file deleted");
  });
  await test("the viewer opens full size, steps through images and closes on Esc", async function () {
    await pickFiles("1", [png("a.png"), png("b.png")]);
    var thumbs = $$(".img-thumb", card("1")); eq(thumbs.length, 2, "two thumbnails");
    thumbs[0].click(); await tick();
    var ov = $(".lb-overlay"); ok(ov, "viewer open");
    ok(/1 \/ 2/.test($(".lb-cap").textContent), $(".lb-cap").textContent);
    key(document.activeElement, "ArrowRight"); await tick();
    ok(/2 \/ 2/.test($(".lb-cap").textContent), "next image");
    eq($(".lb-img").getAttribute("src"), "/_blob/" + imagesOf("1")[1].id);
    key(document.activeElement, "Escape"); await tick();
    ok(!$(".lb-overlay"), "closed");
    ok(document.activeElement && document.activeElement.classList.contains("img-thumb"), "focus back on the thumbnail");
  });
  await test("malformed image ids from the board are ignored", async function () {
    window.__remote("items/5", { images: [{ id: "../../etc/passwd" }, { id: "<img onerror=x>" }, { id: "0123456789abcdef0123456789abcdef" }] }); await tick(60);
    var srcs = $$(".imgstrip img", card("5")).map(function (i) { return i.getAttribute("src"); });
    eq(srcs, ["/_blob/0123456789abcdef0123456789abcdef"]);
  });
  await test("a card holds at most 8 images", async function () {
    var many = []; for (var i = 0; i < 10; i++) many.push(png("p" + i + ".png"));
    await pickFiles("4", many); await tick(150);
    eq(imagesOf("4").length, 8, "capped at 8");
    ok(/8 images at most/.test($(".img-msg", card("4")).textContent), "says why");
  });

  // ---- the default dark look (the owner's chosen colors) ----
  function rgb(el, prop) { return getComputedStyle(el)[prop]; }
  function near(a, b) { // "rgb(…)" or "color(srgb …)" within 1 per channel
    function parts(c) {
      var m = (String(c).match(/[\d.]+/g) || []).map(Number); if (m.length < 3) return [NaN, NaN, NaN];
      if (/^color\(/.test(c)) m = m.slice(0, 3).map(function (v) { return v * 255; });
      return m.slice(0, 3);
    }
    var x = parts(a), y = parts(b); return x.every(function (v, i) { return Math.abs(v - y[i]) <= 1.01; });
  }
  await test("dark mode defaults to the slate page and brown cards", async function () {
    await pick('[data-palette="warm"]'); await pick('[data-mode="dark"]'); $("#themeBtn").click(); await tick();
    var cs = getComputedStyle(document.documentElement);
    eq([cs.getPropertyValue("--bg").trim(), cs.getPropertyValue("--surface").trim(), cs.getPropertyValue("--card").trim()], ["#1b1f22", "#212528", "#624f32"]);
    eq(rgb(document.body, "backgroundColor"), "rgb(27, 31, 34)", "page");
    eq(rgb($(".arc-item"), "backgroundColor"), "rgb(98, 79, 50)", "archive card");
    await themeReset();
  });
  await test("text on the brown cards is lifted to stay readable", async function () {
    await pick('[data-mode="dark"]'); $("#themeBtn").click(); await tick();
    eq(rgb($(".why", card("1")), "color"), "rgb(195, 188, 177)", "note text on a card");
    eq(rgb($(".workbtn", card("1")), "color"), "rgb(185, 182, 245)", "Work on this on a card");
    eq(rgb($("#searchInput"), "color"), rgb(document.body, "color"), "text outside cards unchanged");
    ok(rgb($(".statl"), "color") === "rgb(167, 157, 140)", "muted text outside cards keeps its color: " + rgb($(".statl"), "color"));
    await themeReset();
  });
  await test("other palettes keep plain cards in dark mode", async function () {
    await pick('[data-palette="ocean"]'); await pick('[data-mode="dark"]'); $("#themeBtn").click(); await tick();
    eq(rgb($(".arc-item"), "backgroundColor"), rgb($(".stat"), "backgroundColor"), "card = panel color, not brown");
    eq(rgb($(".workbtn", card("1")), "color"), "rgb(92, 195, 240)", "Ocean's own accent on cards");
    await themeReset();
  });
  await test("Light mode shows light cards even when Claude itself is dark", async function () {
    document.documentElement.setAttribute("data-theme", "dark");
    await pick('[data-mode="light"]'); $("#themeBtn").click(); await tick();
    eq(rgb($(".arc-item"), "backgroundColor"), "rgb(255, 254, 251)", "light card");
    eq(rgb(document.body, "backgroundColor"), "rgb(246, 244, 238)", "light page");
    document.documentElement.removeAttribute("data-theme");
    await themeReset();
  });
  await test("the default paints the same colors as the owner's saved custom colors", async function () {
    await pick('[data-mode="dark"]'); $("#themeBtn").click(); await tick();
    // looked up fresh each time: a theme change re-renders tiles and cards
    var probes = [function () { return document.body; }, function () { return $(".stat"); }, function () { return $(".col"); }, function () { return card("4"); }, function () { return $(".arc-item"); }];
    var paint = function () { return probes.map(function (f) { return rgb(f(), "backgroundColor"); }); };
    var before = paint();
    window.__remote("meta/theme", { palette: "warm", mode: "dark", custom: { dark: { bg: "#1b1f22", card: "#624f32" }, light: {} } }); await tick();
    var after = paint();
    before.forEach(function (b, i) { ok(near(b, after[i]), "probe " + i + ": default " + b + " vs custom " + after[i]); });
    window.__remote("meta/theme", { palette: "warm", mode: "auto", custom: { light: {}, dark: {} } }); await tick();
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
