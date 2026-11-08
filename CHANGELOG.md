# Changelog

All notable changes to Backlog Board are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
