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
  cwd: string
}
