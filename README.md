# Backlog Board

A private, per-project backlog for Claude Code. Defer a task in plain language and
Claude captures it; say **"show backlog"** and Claude opens a colorful drag-and-drop
Kanban board of everything you've saved for that project.

- **Capture by talking.** Say *"save to backlog: X"* (or just defer something — "later",
  "let's do that another time") and it's filed with a priority, value, effort, and an
  optional note on why it matters, and it syncs onto the board right away. Near-duplicates
  are skipped.
- **A real board, not a list.** "Show backlog" opens a Kanban board with three priority
  lanes (Urgent / Important / Nice to have) plus an Archive. Drag cards to reorder or
  re-prioritize, click to edit the name, note, value, effort, or status, and mark cards
  done to archive them.
- **Due dates.** Give a card a date with 📅; it turns amber when it's close and red when
  overdue, and an *Overdue* tile counts them. Search, filters and sort are remembered in
  your browser, and the archive offers to clear cards finished more than 30 days ago.
- **Quick commands.** `/backlog` shows your board's link and anything not on it yet;
  `/backlog add <task> !urgent` captures without asking Claude (`!important`, `!nice` work
  too); `/backlog inbox` lists captures waiting to sync.
- **Nothing gets lost.** If a capture hasn't reached the board yet, a line under the prompt
  says so (e.g. *2 backlog items not on the board yet — say "show backlog" to sync*) and
  clears itself once they're synced.
- **Hand work back to Claude.** Click **▶ Work on this** on any card and tell Claude
  *"start my backlog pick"* — Claude reads what you picked and starts working on it.
- **Private and per-project.** Captures live in a per-project file under your home
  (`~/.claude/backlogs/`), never inside the repo you're working in. Each project gets
  its own board.

## Using the board

### Quick start

1. **Install the plugin** (see [Install](#install)) and open Claude Code in your project.
2. **Capture something.** Say *"save to backlog: add dark mode, it's the top user request"*,
   or type `/backlog add Add dark mode !important`.
3. **Open the board.** Say *"show backlog"*. The first time, Claude creates a private board
   for this project and gives you its link; after that it opens the same board.
4. **Hand a card back.** On the board, click **▶ Work on this** on a card, then tell Claude
   *"start my backlog pick"*. When Claude finishes, the card moves to the Archive with a
   ✓ line saying what was done.

### What to say to Claude

| Say… | What happens |
| --- | --- |
| *"save to backlog: …"*, *"later"*, *"let's do that another time"* | Captures a task (Claude fills in priority, value, effort and the reason you gave) and syncs it to the board. Near-duplicates are skipped or flagged. |
| *"show backlog"* / *"open the board"* | Opens the board, bringing in anything not on it yet. |
| *"start my backlog pick"* (the board says *"start my pick"* — either works) | Claude reads the card you picked, says which one it's starting, and gets to work. |
| *"work on the dark mode item"* | Same, for a card you name instead of picking. |
| *"sync projects"* / *"update the project switcher"* | Refreshes the **Projects ▾** list from all your project boards. |

### Slash commands

| Command | What it does |
| --- | --- |
| `/backlog` | Shows your board's link and anything not on it yet. |
| `/backlog add <task> [!urgent \| !important \| !nice]` | Captures right away, without asking Claude (default lane: Important). |
| `/backlog inbox` | Lists captures that haven't reached the board yet. |
| `/backlog help` | Lists the commands. |

### A tour of the board

**Lanes.** Cards sit in three lanes — **Urgent**, **Important**, **Nice to have** — plus an
**Archive** at the bottom for finished cards. Click the **+** next to a lane's name to add a
card there (Enter adds it and keeps the box open for another; Esc closes it).

**Editing a card.** Everything on a card is clickable:

- **Name** and **"Why it matters" note** — click to edit, Enter to save.
- **Value** (the five dots) — how worthwhile it is, 1–5. Click the current dot again to lower it.
- **Effort** (S / M / L / XL) — click to cycle.
- **Status** (*To do* / *In progress*) — click to toggle.
- **+ Subtask** — adds a checklist with a progress bar. Tick items off, click one to rename
  it, ✕ to remove it.
- **📅** — set a due date. The chip reads *Due Jan 12*, turns amber within 3 days (*Due
  tomorrow*), and red once it's past (*Overdue 4d*). Click it to change or remove the date.
- **🔗** — attach a link (a PR, issue, commit or branch). It shows as a short chip like
  *PR #12* or *commit abc1234*. Only `http(s)` links are accepted.
- **●** (the colored dot) — recolor the card from a palette or a custom color; *Default*
  goes back to the lane color.
- **▾** — collapse the card to just its name.
- **✓** — mark it done (it moves to the Archive). **✕** — delete it (asks first).

**Moving cards.** Drag a card to reorder it or drop it in another lane. On a phone, tablet or
keyboard, use the **⇅** button at the card's top right instead: it opens **↑ Up**, **↓ Down**
and buttons for the other lanes. With the keyboard, **Alt+↑ / Alt+↓** moves the card you're
on. Moving is paused while a search, filter or the quick-wins sort is on, so the order you
see is always the real one.

**Picking a card for Claude.** **▶ Work on this** marks the card *📌 Picked for Claude* and
shows a bar at the top; tell Claude *"start my backlog pick"*. **Clear** un-picks it.

**The toolbar.**

- **Projects ▾** — jump to another project's board. The list is refreshed whenever you open
  the backlog or say *"sync projects"*.
- **Search** — matches card names and notes.
- **Effort** and **Status** filters — show only the cards you pick; *Showing N of M* says how
  many are hidden. **Clear filters** resets them.
- **Sort: Manual / Quick wins ★** — *Quick wins* orders each lane by value ÷ effort (S counts
  1, M 2, L 3, XL 4). Cards scoring 2.5 or more get a ★ either way.
- **⬇ Export .md** — downloads the whole board as `backlog.md` (or shows it to copy).
- **Hide controls / Show controls** (next to the title) — folds away the intro, toolbar and
  stats so the lanes start at the top. While folded it says *filters on* if anything is
  filtering the board.

Your search, filters, sort and the folded/unfolded state are remembered in your browser.

**Stats.** The strip above the lanes shows **Active**, **In progress**, **Done · 7d**,
**Oldest active** (red at 14 days or more; hover for its name), **Avg age**, and **Overdue**
(hover for the names).

**Archive.** Finished cards, newest first, each with its note and Claude's ✓ result line
(any links in it are clickable).
**↺** puts a card back on the board; **✕** deletes it for good (asks first). When cards were
finished more than 30 days ago, a **Remove N cards done more than 30 days ago** button
clears them in one go (also asks first).

**Reminder under the prompt.** If something you captured hasn't reached the board yet,
Claude Code shows a line like *2 backlog items not on the board yet — say "show backlog" to
sync*. It disappears once they're synced.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install backlog --marketplace kasperjunky/Backlog-Board
```

From a shell:

```
claude plugin install backlog --marketplace kasperjunky/Backlog-Board
```

In the desktop app (where `/plugin` doesn't run): click **+** next to the prompt box →
**Plugins** → **Add marketplace** with `kasperjunky/Backlog-Board` → **Add plugin**.

> This is a **private** repository, so it installs only for people it's shared with on
> GitHub who also have a github.com git credential set up on their machine (an SSH key,
> or `gh auth login` followed by `gh auth setup-git`).

## How it works

The plugin is a hooks module. On session start it registers an `add` tool (how captures
are filed) and a `/backlog` command, and it tells Claude where your private backlog file
lives and how to sync captures onto your board. The board UI ships with the plugin
(`board.html`); the first time you say "show backlog" in a project, Claude publishes it as
a private claude.ai Artifact with a small shared database and remembers its link.

## Security

- **Board text is treated as data.** Claude is told never to follow instructions found
  in card names, notes, subtasks, links or results. When you hand it a pick, it reads
  the card itself, says which item it's starting, and asks before doing anything the card
  spells out beyond ordinary work in the project (running a given command, visiting a
  URL, touching credentials or other repos).
- **Only Editors and the owner can write to a board.** New boards are published with
  database rules that let people the board is shared with read it but not change it.
- **Only `http(s)` links are clickable.** `javascript:` and other schemes are dropped.
- **A damaged backlog file is never overwritten.** If `~/.claude/backlogs/<project>.json`
  stops parsing, the mod pauses captures and keeps a `.corrupt-<time>` copy beside it.
- **Shared boards don't list your other projects** in the project switcher.

## Development

```
claude plugin validate .              # manifest + hooks
claude plugin test .                  # mod tests (tests/*.test.tsx)
npx -p typescript tsc -p . --noEmit   # type-check (once the engine has written the types)
node scripts/test-board.mjs           # board tests in headless Chrome/Edge (no npm install)
node scripts/build-publish.mjs        # dist/board.publish.html, the file to publish
sh scripts/install-hooks.sh           # once: run the leak scan before every push
sh scripts/leak-scan.sh               # or run it by hand
```

- **Board tests** (`tests/board/`) run `board.html` against an in-memory stand-in for the
  artifact database (`mock-db.js`), offline and in a throwaway browser profile. Set
  `CHROME_PATH` if Chrome or Edge isn't in a standard location.
- **Publishing:** `board.html` has no `<!doctype>`/`<head>` of its own. Publish
  `dist/board.publish.html`, which wraps it in the standard artifact page skeleton, or the
  board renders in quirks mode. The skeleton is read from `SKELETON_OPEN` in
  `hooks/register.tsx`, so the script and the mod's instructions always match.
- **Types:** the editor types under `.claude-plugin/types/` are generated by the engine when
  the plugin loads and are not committed. `tsconfig.json` leaves out the generated
  MCP-tool types, which can grow too large for `tsc` (TS2589) and aren't used here.

## License

MIT © 2026 kasperjunky — see [LICENSE](LICENSE).
