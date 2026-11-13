import { expect, mock, test } from 'claude-code/testing'

// Stand in for the world beneath the plugin: env vars and an in-memory file
// system, plus the registrations session.start makes.
// The status line the mod last set ($.ui.status), per wired test.
const statusOf = new WeakMap<object, { text: string | undefined; calls: number }>()

function wire(on: any) {
  const files: Record<string, string> = {}
  const status = { text: undefined as string | undefined, calls: 0 }
  statusOf.set(files, status)
  on('ui.status', (_: any, e: any) => { status.text = e.text; status.calls++; return { value: undefined } })
  on('turn.complete', () => ({ text: 'the answer' }))
  on('prompt.context', () => ({ blocks: [] }))
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

test('a torn write is healed from the .bak copy, keeping the broken text', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj7b', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Survives the crash' })
  const path = backlogPath(files)
  const good = files[path] as string
  // every save keeps the previous good text beside the file
  expect(files[path + '.bak']).toBeTruthy()
  // a second save makes the copy the text that holds the first capture
  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Second capture' })
  expect(files[path + '.bak']).toBe(good)

  // the last write is cut short: the file no longer parses
  const torn = (files[path] as string).slice(0, 40)
  files[path] = torn
  await $.session.start({ cwd: '/proj7b', surface: 'desktop', isInteractive: true })
  const healed = readFile(files)
  expect(healed.inbox.map((i: any) => i.name)).toEqual(['Survives the crash'])
  const kept = Object.keys(files).find(p => p.startsWith(path + '.corrupt-'))
  expect(files[kept as string]).toBe(torn)

  // and captures keep working afterwards
  const r = await $.tool.call({ tool: 'mcp__backlog__add', name: 'After healing' })
  expect((r as any).result).toMatch(/Added #/)
  expect(readFile(files).inbox.length).toBe(2)
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

// ---- /backlog subcommands and the status-line reminder ----

function statusText(files: Record<string, string>): string | undefined {
  return (statusOf.get(files) as { text: string | undefined }).text
}

test('/backlog add captures with a priority flag', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj12', surface: 'desktop', isInteractive: true })
  const out = await $.command.run({ command: 'backlog', args: 'add Fix flaky login test !urgent' })
  expect((out as any).text).toMatch(/Added #1 "Fix flaky login test" \(urgent/)
  const item = readFile(files).inbox[0]
  expect(item.name).toBe('Fix flaky login test')
  expect(item.priority).toBe('urgent')
})

test('/backlog add dedupes like the tool and needs a name', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj13', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Write release notes' })
  const dup = await $.command.run({ command: 'backlog', args: 'add write release notes' })
  expect((dup as any).text).toMatch(/not added/i)
  const empty = await $.command.run({ command: 'backlog', args: 'add !nice' })
  expect((empty as any).text).toMatch(/usage/i)
  expect(readFile(files).inbox.length).toBe(1)
})

test('/backlog add asks Claude to sync only when a board exists', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj14', surface: 'desktop', isInteractive: true })
  const noBoard = await $.command.run({ command: 'backlog', args: 'add First thing' })
  expect(((noBoard as any).context ?? []).length).toBe(0)

  const path = backlogPath(files)
  const f = readFile(files); f.boardUrl = 'https://board/1'; files[path] = JSON.stringify(f)
  const withBoard = await $.command.run({ command: 'backlog', args: 'add Second thing' })
  expect(((withBoard as any).context ?? []).join(' ')).toMatch(/AUTO-SYNC/)
})

test('/backlog inbox lists what is waiting, and says when nothing is', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj15', surface: 'desktop', isInteractive: true })
  const none = await $.command.run({ command: 'backlog', args: 'inbox' })
  expect((none as any).text).toMatch(/nothing waiting/i)
  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Tidy the README', priority: 'nice' })
  const one = await $.command.run({ command: 'backlog', args: 'inbox' })
  expect((one as any).text).toMatch(/#1\s+Tidy the README\s+\(nice/)
  expect(readFile(files).inbox.length).toBe(1)
})

test('/backlog with no arguments shows the board link', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj16', surface: 'desktop', isInteractive: true })
  const path = backlogPath(files)
  const f = readFile(files); f.boardUrl = 'https://board/xyz'; files[path] = JSON.stringify(f)
  const out = await $.command.run({ command: 'backlog', args: '' })
  expect((out as any).text).toMatch(/https:\/\/board\/xyz/)
  const help = await $.command.run({ command: 'backlog', args: 'help' })
  expect((help as any).text).toMatch(/\/backlog add/)
})

test('the status line flags captures not on the board, and clears after a sync', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj17', surface: 'desktop', isInteractive: true })
  expect(statusText(files)).toBe(undefined)

  await $.tool.call({ tool: 'mcp__backlog__add', name: 'Ship the thing' })
  expect(statusText(files)).toMatch(/1 backlog item captured/)

  // Claude drains the inbox to the board during its turn...
  const path = backlogPath(files)
  const f = readFile(files); f.inbox = []; f.boardUrl = 'https://board/2'; files[path] = JSON.stringify(f)
  // ...and the end of the turn refreshes the line
  const done = await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 10 })
  expect((done as any).text).toBe('the answer')
  expect(statusText(files)).toBe(undefined)
})

test('a fresh session reminds about leftovers from last time', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/proj18', surface: 'desktop', isInteractive: true })
  const path = backlogPath(files)
  files[path] = JSON.stringify({ nextId: 3, known: [], knownNames: [], boardUrl: 'https://board/3', cwd: '/proj18',
    inbox: [{ id: 1, name: 'A', priority: 'nice', value: 3, effort: 'M', notes: '', addedAt: '2026-11-01' },
            { id: 2, name: 'B', priority: 'nice', value: 3, effort: 'M', notes: '', addedAt: '2026-11-01' }] })
  await $.session.start({ cwd: '/proj18', surface: 'desktop', isInteractive: true })
  expect(statusText(files)).toMatch(/2 backlog items not on the board yet/)
})

// ---- team boards: /backlog team, /backlog use, the repo link file ----

const TEAM_BOARD = 'https://claude.ai/artifact/TeamBoard123'

// The repo link file the mod wrote, whatever path spelling the engine used.
function repoLinkPath(files: Record<string, string>): string | undefined {
  return Object.keys(files).find(p => p.includes('backlog-board.json'))
}
function setBoard(files: Record<string, string>, fields: Record<string, unknown>) {
  const path = backlogPath(files)
  files[path] = JSON.stringify(Object.assign(readFile(files), fields))
}

test('/backlog team needs a board first', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/team1', surface: 'desktop', isInteractive: true })
  const out = await $.command.run({ command: 'backlog', args: 'team' })
  expect((out as any).text).toMatch(/no board/i)
  expect(repoLinkPath(files)).toBe(undefined)
})

test('/backlog team writes the repo link and asks Claude to mark the board', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/team2', surface: 'desktop', isInteractive: true })
  setBoard(files, { boardUrl: TEAM_BOARD })
  const out = await $.command.run({ command: 'backlog', args: 'team' })
  expect((out as any).text).toMatch(/commit that file/i)
  expect(((out as any).context ?? []).join(' ')).toMatch(/meta\/team/)
  const link = repoLinkPath(files) as string
  expect(link).toBeTruthy()
  expect(JSON.parse(files[link] as string).board).toBe(TEAM_BOARD)
  // the owner already uses that board: no "join it" nag
  await $.session.start({ cwd: '/team2', surface: 'desktop', isInteractive: true })
  expect(statusText(files)).toBe(undefined)
})

test('a repo link is only a suggestion until the person runs /backlog use repo', async ($: any, on: any) => {
  const files = wire(on)
  // the owner links the board in the repo…
  await $.session.start({ cwd: '/team3', surface: 'desktop', isInteractive: true })
  setBoard(files, { boardUrl: TEAM_BOARD })
  await $.command.run({ command: 'backlog', args: 'team' })
  // …and a teammate (no board of their own) opens the same repo
  setBoard(files, { boardUrl: null, useBoardUrl: null, inbox: [{ id: 1, name: 'Mine', priority: 'nice', value: 3, effort: 'M', notes: '', addedAt: '2026-11-07' }] })
  await $.session.start({ cwd: '/team3', surface: 'desktop', isInteractive: true })
  expect(readFile(files).useBoardUrl).toBe(null)
  expect(statusText(files)).toMatch(/run \/backlog use repo/)

  const out = await $.command.run({ command: 'backlog', args: 'use repo' })
  expect((out as any).text).toMatch(/now uses the shared board/)
  expect(readFile(files).useBoardUrl).toBe(TEAM_BOARD)
  const ctx = ((out as any).context ?? []).join(' ')
  expect(ctx).toMatch(/TeamBoard123/)
  expect(ctx).toMatch(/DRAIN the 1 waiting/)
  expect(statusText(files)).toMatch(/1 backlog item not on the board yet/)
})

test('/backlog use takes a board link, refuses anything else, and own switches back', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/team4', surface: 'desktop', isInteractive: true })
  setBoard(files, { boardUrl: 'https://claude.ai/artifact/MyOwnBoard1' })

  const bad = await $.command.run({ command: 'backlog', args: 'use https://evil.example/artifact/x' })
  expect((bad as any).text).toMatch(/doesn’t look like a board link/)
  expect(readFile(files).useBoardUrl).toBe(null)

  await $.command.run({ command: 'backlog', args: 'use ' + TEAM_BOARD + '/' })
  expect(readFile(files).useBoardUrl).toBe(TEAM_BOARD)
  const show = await $.command.run({ command: 'backlog', args: 'use' })
  expect((show as any).text).toMatch(/uses the shared board: https:\/\/claude\.ai\/artifact\/TeamBoard123/)
  const where = await $.command.run({ command: 'backlog', args: '' })
  expect((where as any).text).toMatch(/TeamBoard123/)

  const back = await $.command.run({ command: 'backlog', args: 'use own' })
  expect((back as any).text).toMatch(/back on your own board/)
  expect(readFile(files).useBoardUrl).toBe(null)
  expect(readFile(files).boardUrl).toBe('https://claude.ai/artifact/MyOwnBoard1')
})

test('/backlog use repo without a link file explains what to do', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/team5', surface: 'desktop', isInteractive: true })
  const out = await $.command.run({ command: 'backlog', args: 'use repo' })
  expect((out as any).text).toMatch(/no \.claude\/backlog-board\.json/)
  expect(readFile(files).useBoardUrl).toBe(null)
})

test('a malformed repo link file is ignored', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/team6', surface: 'desktop', isInteractive: true })
  setBoard(files, { boardUrl: TEAM_BOARD })
  await $.command.run({ command: 'backlog', args: 'team' })
  const link = repoLinkPath(files) as string
  files[link] = JSON.stringify({ board: 'javascript:alert(1)' })
  setBoard(files, { boardUrl: null })
  await $.session.start({ cwd: '/team6', surface: 'desktop', isInteractive: true })
  expect(statusText(files)).toBe(undefined)
  const out = await $.command.run({ command: 'backlog', args: 'use repo' })
  expect((out as any).text).toMatch(/no \.claude\/backlog-board\.json/)
})

test('captures on a shared board ask Claude to sync there', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/team7', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'backlog', args: 'use ' + TEAM_BOARD })
  const out = await $.command.run({ command: 'backlog', args: 'add Shared thing !urgent' })
  expect((out as any).text).toMatch(/goes onto the board/)
  expect(((out as any).context ?? []).join(' ')).toMatch(/AUTO-SYNC/)
})

// ---- "do item #X", images, and the local mirror for Cursor ----

async function contextText($: any, on: any): Promise<string> {
  const r = await $.prompt.context({ blocks: [] })
  const b = ((r as any).blocks as any[]).find(x => x.name === 'backlog')
  return b ? String(b.text) : ''
}
// .cursor/mcp.json for a project, spelled the way the engine spells paths:
// learned from the repo link file /backlog team writes in the same project.
async function cursorConfigPath($: any, files: Record<string, string>): Promise<string> {
  const path = backlogPath(files)
  files[path] = JSON.stringify(Object.assign(readFile(files), { boardUrl: 'https://claude.ai/artifact/MirrorBoard1' }))
  await $.command.run({ command: 'backlog', args: 'team' })
  const link = Object.keys(files).find(p => p.includes('backlog-board.json')) as string
  const sep = link.includes('\\') ? '\\' : '/'
  return link.replace('.claude' + sep + 'backlog-board.json', '.cursor' + sep + 'mcp.json')
}

test('Claude is told how "#X" maps to a card and that images are mandatory', async ($: any, on: any) => {
  wire(on)
  await $.session.start({ cwd: '/mirror1', surface: 'desktop', isInteractive: true })
  const text = await contextText($, on)
  expect(text).toMatch(/DO ITEM #X/)
  expect(text).toMatch(/#A1–#A999 are 1000–1998/)
  expect(text).toMatch(/MUST look at every one before/)
  expect(text).toMatch(/CURSOR: no/)
})

test('a project set up for Cursor turns the mirror on, with its own folder', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/mirror2', surface: 'desktop', isInteractive: true })
  const cfg = await cursorConfigPath($, files)
  files[cfg] = JSON.stringify({ mcpServers: { backlog: { command: 'npx', args: ['-y', 'github:kasperjunky/Backlog-Board', '--project', '${workspaceFolder}'] } } })
  await $.session.start({ cwd: '/mirror2', surface: 'desktop', isInteractive: true })
  const text = await contextText($, on)
  expect(text).toMatch(/CURSOR: yes/)
  // the mirror lives in a folder named like the backlog file, without .json
  const key = backlogPath(files).replace(/^.*[\\/]/, '').replace(/\.json$/, '')
  expect(text).toContain(key + '/cards.json')
  expect(text).toContain(key + '/images')
})

test('an unrelated Cursor MCP config does not turn the mirror on', async ($: any, on: any) => {
  const files = wire(on)
  await $.session.start({ cwd: '/mirror3', surface: 'desktop', isInteractive: true })
  const cfg = await cursorConfigPath($, files)
  files[cfg] = JSON.stringify({ mcpServers: { other: { command: 'some-tool' } } })
  await $.session.start({ cwd: '/mirror3', surface: 'desktop', isInteractive: true })
  expect(await contextText($, on)).toMatch(/CURSOR: no/)
})
