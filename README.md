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
