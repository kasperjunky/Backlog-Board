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
