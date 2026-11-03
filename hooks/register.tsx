import type { Register } from 'claude-code'

import type { BacklogFile, Effort, InboxItem, Priority } from '../types'

// The backlog is private and lives in one JSON file per project, under the
// user's home ~/.claude/backlogs/, never inside the project (so it is never
// committed). This mod only CAPTURES into that file; the rich view is a
// drag-and-drop Kanban board artifact that Claude opens on "show backlog".
// $ can only be spelled $.noun.method(...) at a call site, so every file read
// and write is inlined in the hook that needs it; the helpers below are pure.
let filePath = ''
let boardTemplate = ''

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const up = await $.env.get('USERPROFILE')
    const hm = await $.env.get('HOME')
    const home = (up ?? hm ?? '').replace(/\\/g, '/')
    const key = (e.cwd ?? 'unknown').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    filePath = home + '/.claude/backlogs/' + key + '.json'
    let root = ''
    try { root = $.plugin.root } catch { root = '' }
    boardTemplate = (root + '/board.html').replace(/\\/g, '/')

    // Create this project's backlog file the first time we see it.
    if (!(await $.fs.exists(filePath))) {
      await $.fs.write(filePath, JSON.stringify(emptyFile(), null, 2))
    }

    await $.tool.register({
      name: 'add',
      description:
        'Add one item to this project’s backlog. Call it when the user says ' +
        '"later", "save to backlog", or clearly defers a task. Near-duplicates ' +
        'are skipped. Fields: name (required); priority urgent|important|nice; ' +
        'value 1-5 (how worthwhile); effort S|M|L|XL (how hard); notes (why it ' +
        'matters / any context worth keeping — include it whenever the user gave ' +
        'a reason).',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short task name.' },
          priority: { type: 'string', enum: ['urgent', 'important', 'nice'] },
          value: { type: 'integer', minimum: 1, maximum: 5 },
          effort: { type: 'string', enum: ['S', 'M', 'L', 'XL'] },
          notes: { type: 'string', description: 'Why it matters / context (optional).' },
        },
        required: ['name'],
      },
    })

    await $.command.register({
      name: 'backlog',
      description: 'Open this project’s drag-and-drop backlog board.',
    })

    return next(e)
  })

  // Tell the model how to capture and how to open the board, and where the
  // private file lives — added as a context block on the first message.
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const block = {
      name: 'backlog',
      text:
        'A private, per-project Kanban backlog board is active for this project. ' +
        'Its data file (owned by the backlog mod) is at: ' + filePath + '\n' +
        'CAPTURE: when the user says "later", "save to backlog", or clearly defers ' +
        'a task, call mcp__backlog__add with { name, priority (urgent|important|nice), ' +
        'value (1-5), effort (S|M|L|XL), notes }; infer fields from context and put ' +
        'any reason the user gave for the task into notes. The add tool skips exact ' +
        'and near-duplicate (word-overlap) names; it cannot judge meaning, so before ' +
        'adding, if the new task clearly means the same as something already captured ' +
        '(even if worded very differently, e.g. "push to GitHub" vs "re-push the ' +
        'mod"), do not just add it — tell the user it looks like a duplicate of that ' +
        'item and ask whether to add anyway or skip.\n' +
        'AUTO-SYNC: right after a successful add (the tool replies "Added #…"), ' +
        'immediately sync the new item to the board — do exactly the SHOW / OPEN ' +
        'drain described below (write each inbox item into the board’s `items` ' +
        'collection, set inbox to [], append each drained item’s normalized name to ' +
        '`known` and its original name to `knownNames`, ' +
        'write the file back) but do NOT open the board; just confirm the item was ' +
        'added. If boardUrl is null, skip the sync and leave the item in inbox for the ' +
        'next "show backlog" (do not build a board just for a capture). Do not capture ' +
        'the task currently being worked on, and do not mention the backlog unless the ' +
        'user brings it up or an item was added.\n' +
        'SHOW / OPEN: when the user asks to show, open or see the backlog or board, ' +
        'read that JSON file — it is { nextId, known, knownNames, inbox, boardUrl }. If boardUrl ' +
        'is set, drain every item in `inbox` into that artifact’s `items` ' +
        'collection with the artifact database (one document per item; doc id = the ' +
        'item id as a string; fields name, priority, value, effort, notes, ' +
        'status:"todo", order = the item id, addedAt, finishedAt:null), then set ' +
        'inbox to [], append each drained item’s normalized name (lowercased, ' +
        'non-alphanumerics removed) to `known` and its original name to `knownNames`, ' +
        'write the file back, and open the ' +
        'board artifact. If boardUrl is null, create the board from the template ' +
        'that ships with this plugin: publish the HTML file at ' + boardTemplate +
        ' as a new Artifact with capabilities {db:{}, downloads:true} (that file IS ' +
        'the board UI — ' +
        'publish it as-is, do not rewrite it), save the new artifact URL into ' +
        'boardUrl, then drain as above.\n' +
        'WORK ON A PICK: the board has a "▶ Work on this" button that writes a ' +
        'document `handoff/current` = { itemId, name, notes, priority, value, effort } ' +
        'to the board’s artifact database. When the user says "start my backlog pick", ' +
        '"work on the item I picked", "start the backlog item", or names one to work ' +
        'on, read `handoff/current` (and/or the named item in `items`) from the board ' +
        'db to get its name and notes, set that item’s status to "doing", delete ' +
        '`handoff/current`, and then actually start the work. When the work is ' +
        'finished, close the loop on that item’s `items` doc: set status "done", ' +
        'finishedAt (today), and write a short `result` string — one line on what was ' +
        'done, plus any commit SHA or PR URL. If `handoff/current` is missing and the ' +
        'user did not name an item, ask which item to start.',
    }
    return { ...result, blocks: [...result.blocks, block] }
  })

  // Serve the add tool: append to the file's inbox. The result must be a
  // string (the model reads it) — never an object.
  on('tool.call', { tool: 'mcp__backlog__add' }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const name = String(input.name ?? '').replace(/\s+/g, ' ').trim()
    if (!name) return { result: 'No item name was given.' }

    let txt = ''
    try { txt = await $.fs.read(filePath) } catch { txt = '' }
    const file = txt ? normalizeFile(safeParse(txt)) : emptyFile()

    const norm = normalizeName(name)
    const dupInbox = file.inbox.find(i => normalizeName(i.name) === norm)
    if (dupInbox) {
      return { result: 'Already in your backlog inbox: "' + dupInbox.name + '". Not added.' }
    }
    if (file.known.includes(norm)) {
      return { result: 'Looks like "' + name + '" is already on your backlog board. Not added.' }
    }
    const fuzzy = fuzzyDupName(name, file.knownNames.concat(file.inbox.map(i => i.name)))
    if (fuzzy) {
      return { result: 'Looks like a near-duplicate of "' + fuzzy + '" in your backlog. Not added. If it is genuinely different, rephrase the name and add again.' }
    }

    const item: InboxItem = {
      id: file.nextId,
      name,
      priority: normPriority(input.priority),
      value: normValue(input.value),
      effort: normEffort(input.effort),
      notes: String(input.notes ?? '').replace(/\s+/g, ' ').trim(),
      addedAt: today(),
    }
    file.inbox.push(item)
    file.nextId = file.nextId + 1
    await $.fs.write(filePath, JSON.stringify(file, null, 2))

    return {
      result:
        'Added #' + item.id + ' "' + item.name + '" (' + item.priority +
        ', value ' + item.value + ', effort ' + item.effort + ') to your backlog. ' +
        'Now sync it to the board (auto-sync) without opening the board; no ' +
        '"show backlog" needed.',
    }
  })

  on('command.run', { command: 'backlog' }, async () => {
    return {
      text:
        'Say "show backlog" (or "open the board") and I’ll open your ' +
        'drag-and-drop backlog board and bring in anything newly captured.',
    }
  })
}

// ---- pure helpers (no $) ----

function emptyFile(): BacklogFile {
  return { nextId: 1, known: [], knownNames: [], inbox: [], boardUrl: null }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const STOP: Record<string, boolean> = {
  the: true, a: true, an: true, to: true, of: true, and: true, for: true,
  in: true, on: true, at: true, it: true, is: true, this: true, that: true,
  with: true, my: true, your: true, new: true,
}
function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP[w])
}
// Lexical near-duplicate: high word overlap (Jaccard >= 0.6) or one name's
// significant words are a subset of the other's with >= 2 shared. Catches
// rewordings and expansions; true semantic dups are Claude's job (see context).
function fuzzyDupName(name: string, names: string[]): string | null {
  const a = tokenize(name)
  if (!a.length) return null
  const aset: Record<string, boolean> = {}
  a.forEach(w => { aset[w] = true })
  const aKeys = Object.keys(aset)
  for (const other of names) {
    const b = tokenize(other)
    if (!b.length) continue
    const bset: Record<string, boolean> = {}
    b.forEach(w => { bset[w] = true })
    const bKeys = Object.keys(bset)
    let shared = 0
    aKeys.forEach(w => { if (bset[w]) shared++ })
    let union = aKeys.length
    bKeys.forEach(w => { if (!aset[w]) union++ })
    const jaccard = union ? shared / union : 0
    const subset = shared === aKeys.length || shared === bKeys.length
    if (jaccard >= 0.6 || (subset && shared >= 2)) return other
  }
  return null
}

function safeParse(txt: string): unknown {
  try { return JSON.parse(txt) } catch { return {} }
}

function normalizeFile(obj: unknown): BacklogFile {
  const o = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>
  const inboxRaw = Array.isArray(o.inbox) ? o.inbox : []
  const knownRaw = Array.isArray(o.known) ? o.known : []
  const knownNamesRaw = Array.isArray(o.knownNames) ? o.knownNames : []
  const inbox: InboxItem[] = inboxRaw.map(toItem).filter((x): x is InboxItem => x !== null)
  const known: string[] = knownRaw.filter((x): x is string => typeof x === 'string')
  const knownNames: string[] = knownNamesRaw.filter((x): x is string => typeof x === 'string')
  const nextId = typeof o.nextId === 'number' && o.nextId > 0 ? Math.floor(o.nextId) : inbox.length + 1
  const boardUrl = typeof o.boardUrl === 'string' ? o.boardUrl : null
  return { nextId, known, knownNames, inbox, boardUrl }
}

function toItem(raw: unknown): InboxItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name : ''
  if (!name) return null
  const id = typeof o.id === 'number' ? o.id : 0
  return {
    id,
    name,
    priority: normPriority(o.priority),
    value: normValue(o.value),
    effort: normEffort(o.effort),
    notes: typeof o.notes === 'string' ? o.notes : '',
    addedAt: typeof o.addedAt === 'string' ? o.addedAt : today(),
  }
}

function normPriority(x: unknown): Priority {
  return x === 'urgent' || x === 'important' || x === 'nice' ? x : 'important'
}

function normValue(x: unknown): number {
  const n = typeof x === 'number' ? Math.round(x) : 3
  return n < 1 ? 1 : n > 5 ? 5 : n
}

function normEffort(x: unknown): Effort {
  return x === 'S' || x === 'M' || x === 'L' || x === 'XL' ? x : 'M'
}
