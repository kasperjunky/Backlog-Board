export type Priority = 'urgent' | 'important' | 'nice'
export type Effort = 'S' | 'M' | 'L' | 'XL'

// One captured-but-not-yet-on-the-board item.
export type InboxItem = {
  id: number
  name: string
  priority: Priority
  value: number
  effort: Effort
  notes: string
  addedAt: string
}

// The private per-project file the mod owns. `inbox` holds new captures the
// board has not drained yet; `known` is the normalized names of every item
// ever captured (so duplicates are skipped even after they leave the inbox);
// `boardUrl` is the Kanban board artifact Claude opens on "show backlog";
// `cwd` is the project's working directory, kept so the cross-project switcher
// can show a friendly name for each project.
export type BacklogFile = {
  nextId: number
  known: string[]
  knownNames: string[]
  inbox: InboxItem[]
  boardUrl: string | null
  // a shared (team) board this project uses instead of its own (/backlog use)
  useBoardUrl: string | null
  cwd: string
  // fingerprint of the board page last published to boardUrl (null: unknown);
  // when the plugin ships a different page, Claude updates the board
  boardTemplate: string | null
  // true once the first conversation in this project has ended: the one-time
  // setup (board created, notes imported) is offered only before that
  welcomed: boolean
}
