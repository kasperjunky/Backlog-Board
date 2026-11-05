import { expect, mock, test } from 'claude-code/testing'

// Stand in for the world beneath the plugin: env vars and an in-memory file
// system, plus the registrations session.start makes.
function wire(on: any) {
  const files: Record<string, string> = {}
  mock.env(on, { USERPROFILE: 'C:/Users/test', HOME: '/home/test' })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.read', (_: any, e: any) => ({ value: e.path in files ? files[e.path] : '' }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('tool.register', () => ({ value: { tool: 'mcp__backlog__add' } }))
  on('command.register', () => ({ value: { command: 'backlog' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  return files
}

// The one backlog file the mod created, whatever path it chose.
function backlogPath(files: Record<string, string>): string {
  const k = Object.keys(files).find(p => p.includes('backlogs'))
  if (!k) throw new Error('no backlog file was written; keys: ' + Object.keys(files).join(', '))
  return k
}
function readFile(files: Record<string, string>): any {
  return JSON.parse(files[backlogPath(files)] as string)
}

test('capturing an item writes it to the inbox file', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const r = await $.tool.call({
    tool: 'mcp__backlog__add',
    name: 'Fix login bug',
    priority: 'urgent',
    value: 4,
    effort: 'M',
    notes: 'Blocks sign-in for SSO users',
  })
  expect((r as any).result).toMatch(/Added #\d+ "Fix login bug"/)

  const file = readFile(files)
  expect(file.inbox.length).toBe(1)
  expect(file.inbox[0].name).toBe('Fix login bug')
  expect(file.inbox[0].priority).toBe('urgent')
  expect(file.inbox[0].value).toBe(4)
  expect(file.inbox[0].notes).toBe('Blocks sign-in for SSO users')
})

test('a near-duplicate already in the inbox is skipped', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj2', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Write docs' })
  const dup = await $.tool.call({ tool: 'mcp__backlog__add', name: 'write   DOCS!' })
  expect((dup as any).result).toMatch(/not added/i)

  expect(readFile(files).inbox.length).toBe(1)
})

test('an item already on the board (in known) is skipped', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj3', surface: 'desktop', isInteractive: true })

  // Seed the file the mod created as if the board already holds this item.
  const path = backlogPath(files)
  files[path] = JSON.stringify({ nextId: 2, known: ['adddarkmodetoggle'], inbox: [], boardUrl: 'https://x/y' })

  const r = await $.tool.call({ tool: 'mcp__backlog__add', name: 'Add dark mode toggle' })
  expect((r as any).result).toMatch(/already on your backlog board/i)

  const file = readFile(files)
  expect(file.inbox.length).toBe(0)
  expect(file.boardUrl).toBe('https://x/y')
})

test('the backlog command points the user at the board', async ($: any, on: any) => {
  wire(on)
  await $.session.start({ cwd: '/proj4', surface: 'desktop', isInteractive: true })
  const out = await $.command.run({ command: 'backlog', args: '' })
  expect((out as any).text).toMatch(/show backlog|open the board/i)
})

test('a reworded / expanded near-duplicate is caught by fuzzy dedup', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj5', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Add dark mode toggle' })
  // reworded ("a", "-", "!") — exact-normalize differs, but the words overlap
  const dup = await $.tool.call({ tool: 'mcp__backlog__add', name: 'add a dark-mode toggle!' })
  expect((dup as any).result).toMatch(/near-duplicate/i)

  expect(readFile(files).inbox.length).toBe(1)
})

test('a genuinely different item is not fuzzy-flagged', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj6', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Add dark mode toggle' })
  const r = await $.tool.call({ tool: 'mcp__backlog__add', name: 'Export board to CSV' })
  expect((r as any).result).toMatch(/Added #/)

  expect(readFile(files).inbox.length).toBe(2)
})

test('session.start records the project cwd for the switcher', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/my/cool/proj', surface: 'desktop', isInteractive: true })
  expect(readFile(files).cwd).toBe('/my/cool/proj')
})

// ---- hardening ----

function jsonFiles(files: Record<string, string>): string[] {
  return Object.keys(files).filter(p => p.includes('backlogs') && p.endsWith('.json'))
}

// The backlog folder exactly as the engine spells it (it may use backslashes),
// learned from a throwaway session, plus that session's file name.
async function backlogDir($: any, files: Record<string, string>): Promise<string> {
  await $.session.start({ cwd: '/seed', surface: 'desktop', isInteractive: true })
  const p = backlogPath(files)
  return p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)
}

test('a corrupt backlog file is never overwritten, and add refuses', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj7', surface: 'desktop', isInteractive: true })
  const path = backlogPath(files)
  const broken = '{"nextId": 9, "boardUrl": "https://x/y", "inbox": [ BROKEN'
  files[path] = broken

  // a restart must not "heal" it into an empty file
  await $.session.start({ cwd: '/proj7', surface: 'desktop', isInteractive: true })
  expect(files[path]).toBe(broken)

  const r = await $.tool.call({ tool: 'mcp__backlog__add', name: 'Anything' })
  expect((r as any).result).toMatch(/could not be parsed/i)
  expect(files[path]).toBe(broken)

  // and the raw text was backed up beside it
  const backup = Object.keys(files).find(p => p.startsWith(path + '.corrupt-'))
  expect(backup).toBeTruthy()
  expect(files[backup as string]).toBe(broken)
})

test('paths that slug the same still get separate backlog files', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: 'D:/a-b', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Only in a-b' })
  await $.session.start({ cwd: 'D:/a/b', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Only in a/b' })

  const paths = jsonFiles(files)
  expect(paths.length).toBe(2)
  const inboxes = paths.map(p => JSON.parse(files[p] as string).inbox.map((i: any) => i.name).join(','))
  expect(inboxes.sort()).toEqual(['Only in a-b', 'Only in a/b'])
})

test('a file under the old (unhashed) name is migrated once, with a marker left', async ($: any, on: any) => {
  const files = wire(on)
  const dir = await backlogDir($, files)
  const legacy = dir + 'proj8.json'
  files[legacy] = JSON.stringify({ nextId: 5, known: ['x'], knownNames: ['X'], inbox: [], boardUrl: 'https://b/1' })
  await $.session.start({ cwd: '/proj8', surface: 'desktop', isInteractive: true })

  const current = jsonFiles(files).find(p => p.includes('proj8-')) as string
  expect(current).toMatch(/proj8-[0-9a-f]{8}\.json$/)
  const moved = JSON.parse(files[current] as string)
  expect(moved.boardUrl).toBe('https://b/1')
  expect(moved.nextId).toBe(5)
  const marker = JSON.parse(files[legacy] as string)
  expect(marker.boardUrl).toBe(null)
  expect(marker.movedTo).toBe(current.slice(dir.length))
})

test('another project’s old-named file is not taken over', async ($: any, on: any) => {
  const files = wire(on)
  const dir = await backlogDir($, files)
  const legacy = dir + 'proj9.json'
  const theirs = JSON.stringify({ nextId: 3, known: [], knownNames: [], inbox: [], boardUrl: 'https://b/2', cwd: '/proj-9' })
  files[legacy] = theirs
  await $.session.start({ cwd: '/proj9', surface: 'desktop', isInteractive: true })
  expect(files[legacy]).toBe(theirs)
  const mine = JSON.parse(files[jsonFiles(files).find(p => p.includes('proj9-')) as string] as string)
  expect(mine.boardUrl).toBe(null)
})

test('long names and notes are capped', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj10', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__backlog__add', name: 'n'.repeat(500), notes: 'w '.repeat(3000) })
  const item = readFile(files).inbox[0]
  expect(item.name.length).toBeLessThanOrEqual(200)
  expect(item.notes.length).toBeLessThanOrEqual(2000)
})

test('the id counter never falls behind ids already used', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj11', surface: 'desktop', isInteractive: true })
  const path = backlogPath(files)
  // nextId lost, but 6 items were already drained to the board
  files[path] = JSON.stringify({ known: ['a', 'b', 'c', 'd', 'e', 'f'], knownNames: [], inbox: [] })
  const r = await $.tool.call({ tool: 'mcp__backlog__add', name: 'Fresh item' })
  expect((r as any).result).toMatch(/Added #7 /)
})
