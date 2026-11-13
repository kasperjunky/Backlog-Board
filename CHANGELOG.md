# Changelog

All notable changes to Backlog Board are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **N adds a card from the keyboard.** Press N (outside a text field) and the new-card
  box opens in the lane you're on — the lane of the focused card or +; elsewhere, the
  lane you last added to, or Urgent. Enter adds, Esc closes. Pairs with Alt+↑ / Alt+↓.
- **Comments on cards.** 💬 opens a per-card thread: anyone who can use the board posts
  a line (author and date shown; remove your own, the owner any); links inside are
  clickable; the Markdown export lists them. Claude reads a card's comments when it
  starts the card, and the Cursor copy (`backlog_item`) includes them. Teammates can
  now talk about a card without rewriting its note.
- **`/backlog done #X [what was done]` and `/backlog note #X <text>`.** Close a card
  (with an optional ✓ result line) or add to its note from the terminal; the command
  checks the card number and hands Claude an exact instruction for its next message,
  so nothing is left to prose. `/backlog close` is an alias of `done`.
- **Undo for deleted cards.** ✕ deletes a card at once (no more "Delete? / Keep"
  step) and a toast offers Undo for 10 seconds; several deletes stack into one
  toast, Undo writes each card back as it was (same number, images, result), and
  Escape on the toast dismisses it. Clearing the archive still asks first.

### Security
- Cursor's `setup` pins the MCP server in `.cursor/mcp.json` to the release that
  ran it (`github:…#backlog--vX.Y.Z`) instead of the `main` branch.
- The board bounds card text on the way in (name 200, notes/result 2,000,
  100 subtasks of 200) so an oversized doc written through the API can't stall it,
  and its status banner is built from text nodes, never markup.
- Claude is told that a card's `result` and `link` are data too, and to ask before
  acting on anything they spell out; the Cursor rule says the same.
- CI runs `claude plugin validate --strict`.

### Fixed
- A backlog file left half-written (the session killed mid-save) is healed from
  the `.bak` copy every save now keeps, instead of pausing captures.

## [0.9.0] - 2026-11-08

### Added
- **"Do item #X" with images.** Ask Claude (or Cursor) to work on a card by its
  board number and it reads the card's notes, subtasks, and any attached
  images before starting, so screenshots, mockups, and designs become part of
  the task instead of being ignored.
- The board's new default look uses the dark palette (warm card tones on a
  charcoal surface) rather than the old light default.

### Changed
- Documented the privacy model in the README's Security section: captures live
  only in `~/.claude/backlogs/` (never a git repo), the board is an owner-only
  private Artifact, and the plugin writes only config into a project — never
  card text.

## [0.8.0] - 2026-11-07

### Added
- **Cursor support.** A zero-dependency MCP server (`cursor/backlog-mcp.mjs`)
  lets Cursor's AI capture tasks and read open cards and their images from a
  local mirror under `~/.claude/backlogs/<project>/`. Install with
  `npx backlog-board-mcp setup`.
- **Running card numbers** (#1–#999, then #A1…) allocated through a shared
  database lease, so every card has a stable number you can refer to.
- **Images on cards.** Drop or paste screenshots, mockups, and designs onto a
  card; they're stored as Artifact assets and shown inline.

## [0.5.0] - 2026-11-07

### Added
- **Team boards** (#18). Share a board with teammates: cards carry an assignee
  and an "added by", with a *Mine* filter and per-person "Work on this" picks.
  `/backlog team` writes the shared board link into the project.
- **Theme picker** — six palettes plus Auto/Light/Dark, saved on the board.
- **Custom background and card colors.**
- **Due dates** with an amber/red urgency state and an *Overdue* tile; remembered
  view (search, filters, sort); and an archive that offers to clear cards
  finished more than 30 days ago.

### Added (project)
- MIT license.

## [0.4.0] - 2026-11-06

### Added
- **`/backlog` subcommands** — `add`, `inbox`, `team` — and a status-line
  reminder when captures haven't reached the board yet.
- **Move cards without dragging** (keyboard-accessible), collapsible controls,
  and an accessibility pass.
- Developer tooling: type-checking, headless-Chrome board tests, and a
  publish build script.

### Changed
- Confirm before an archive delete; keep edits and mid-drag updates when the
  board re-renders.

## [0.3.0] - 2026-11-05

### Added
- First hardened release: security hardening across the mod and the board —
  board text is treated as data (never instructions), inputs are validated,
  and backlog data stays private to `~/.claude/backlogs/`.

[0.9.0]: https://github.com/kasperjunky/Backlog-Board/releases/tag/backlog--v0.9.0
[0.8.0]: https://github.com/kasperjunky/Backlog-Board/commits/main
[0.5.0]: https://github.com/kasperjunky/Backlog-Board/commits/main
[0.4.0]: https://github.com/kasperjunky/Backlog-Board/releases/tag/backlog--v0.4.0
[0.3.0]: https://github.com/kasperjunky/Backlog-Board/commits/main
