#!/usr/bin/env node
// Tests for cursor/backlog-mcp.mjs: talks to the real server over stdio the
// way Cursor does (newline-delimited JSON-RPC), in a throwaway home folder.
//   node scripts/test-mcp.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './build-publish.mjs'

const SERVER = join(ROOT, 'cursor', 'backlog-mcp.mjs')
const mod = await import('file:///' + SERVER.replace(/\\/g, '/'))
const results = []
async function test(name, fn) {
  try { await fn(); results.push([true, name]) } catch (e) { results.push([false, name, e && e.message || String(e)]) }
}
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((what ? what + ': ' : '') + 'expected ' + y + ', got ' + x) }
function ok(c, what) { if (!c) throw new Error(what || 'assertion failed') }

// One running server; send(msg) resolves with its reply (or null for a notification).
function startServer(home, project) {
  const child = spawn(process.execPath, [SERVER, '--project', project], { env: Object.assign({}, process.env, { BACKLOG_HOME: home }), stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = '', waiting = new Map(), nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', d => {
    buf += d
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      const msg = JSON.parse(line); const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); w(msg) }
    }
  })
  return {
    request(method, params) {
      const id = nextId++
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('no reply to ' + method)), 5000)
        waiting.set(id, m => { clearTimeout(t); res(m) })
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
    },
    notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n') },
    raw(text) { child.stdin.write(text + '\n') },
    async call(name, args) { const r = await this.request('tools/call', { name, arguments: args || {} }); return { text: r.result.content[0].text, isError: r.result.isError } },
    stop() { child.kill() },
  }
}

const work = mkdtempSync(join(tmpdir(), 'backlog-mcp-'))
const home = join(work, 'home'), project = join(work, 'my-project')
mkdirSync(project, { recursive: true })
// the test process uses the same throwaway home as the server, so nothing
// it computes (backlog file, local copy) can point at the real ~/.claude
process.env.BACKLOG_HOME = home
if (!mod.backlogFileFor(project).startsWith(home)) { console.error('test-mcp: refusing to run — backlog folder is outside the throwaway home'); process.exit(2) }
const backlogs = join(home, '.claude', 'backlogs')
const srv = startServer(home, project)
const fileNow = () => JSON.parse(readFileSync(join(backlogs, readdirSync(backlogs).find(f => f.endsWith('.json'))), 'utf8'))

try {
  await test('initialize, tools/list and ping speak MCP', async () => {
    const init = await srv.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    eq(init.result.protocolVersion, '2025-06-18')
    eq(init.result.serverInfo.name, 'backlog-board')
    ok(/backlog_add/.test(init.result.instructions), 'instructions mention backlog_add')
    srv.notify('notifications/initialized')
    const list = await srv.request('tools/list', {})
    eq(list.result.tools.map(t => t.name), ['backlog_add', 'backlog_inbox', 'backlog_item', 'backlog_cards', 'backlog_board'])
    eq((await srv.request('ping')).result, {})
    const older = await srv.request('initialize', { protocolVersion: '2024-11-05' })
    eq(older.result.protocolVersion, '2024-11-05', 'older client version honored')
  })
  await test('the file name matches the Claude Code plugin exactly', async () => {
    // the live project's key, as the plugin computed it
    eq(mod.projectKey('D:\\projects\\backlog'), 'D-projects-backlog-9efb5046')
    eq(mod.projectKey('d:/projects/backlog').slice(-8), '9efb5046', 'drive case and slashes ignored by the hash')
  })
  await test('a capture lands in the inbox file the plugin reads', async () => {
    const r = await srv.call('backlog_add', { name: 'Add CSV export', priority: 'urgent', value: 4, effort: 'S', notes: 'Asked for by two users' })
    ok(/^Added #1 "Add CSV export" \(urgent, value 4, effort S\)/.test(r.text), r.text)
    ok(/no board for this project yet/.test(r.text), 'explains there is no board yet')
    const f = fileNow()
    eq([f.inbox.length, f.inbox[0].name, f.inbox[0].notes, f.nextId], [1, 'Add CSV export', 'Asked for by two users', 2])
    eq(f.cwd, project)
  })
  await test('exact and near-duplicates are skipped like the plugin', async () => {
    eq((await srv.call('backlog_add', { name: 'add csv EXPORT!' })).text, 'Already in your backlog inbox: "Add CSV export". Not added.')
    ok(/near-duplicate of "Add CSV export"/.test((await srv.call('backlog_add', { name: 'add an export to CSV' })).text), 'fuzzy dup caught')
    eq(fileNow().inbox.length, 1)
  })
  await test('inbox lists what is waiting', async () => {
    const r = await srv.call('backlog_inbox')
    ok(/1 item not on the board yet:\n  #1  Add CSV export  \(urgent, value 4, effort S\)/.test(r.text), r.text)
  })
  await test('board gives the link, prefers a shared board, and mentions a repo link', async () => {
    const path = join(backlogs, readdirSync(backlogs).find(f => f.endsWith('.json')))
    const f = fileNow(); f.boardUrl = 'https://claude.ai/artifact/OwnBoard123'; writeFileSync(path, JSON.stringify(f))
    ok(/OwnBoard123/.test((await srv.call('backlog_board')).text), 'own board')
    f.useBoardUrl = 'https://claude.ai/artifact/TeamBoard123'; writeFileSync(path, JSON.stringify(f))
    const r = await srv.call('backlog_board'); ok(/TeamBoard123/.test(r.text) && !/OwnBoard123/.test(r.text), r.text)
    mkdirSync(join(project, '.claude'), { recursive: true })
    writeFileSync(join(project, '.claude', 'backlog-board.json'), JSON.stringify({ board: 'https://claude.ai/artifact/OtherTeam456' }))
    ok(/OtherTeam456.*\/backlog use repo/s.test((await srv.call('backlog_board')).text), 'repo link mentioned')
    ok(/next time Claude Code syncs/.test((await srv.call('backlog_add', { name: 'Write release notes' })).text), 'sync hint once a board exists')
  })
  await test('a torn write is healed from the .bak copy that every save keeps', async () => {
    const path = join(backlogs, readdirSync(backlogs).find(f => f.endsWith('.json')))
    const good = readFileSync(path, 'utf8')
    ok(existsSync(path + '.bak'), 'a .bak copy sits beside the file')
    await srv.call('backlog_add', { name: 'One more capture' })
    eq(readFileSync(path + '.bak', 'utf8'), good, 'the copy is the text before the last save')
    const torn = readFileSync(path, 'utf8').slice(0, 30)
    writeFileSync(path, torn)
    const r = await srv.call('backlog_inbox')
    ok(!r.isError && /Write release notes/.test(r.text), 'reads the healed file: ' + r.text)
    eq(readFileSync(path, 'utf8'), good, 'the copy was put back')
    ok(readdirSync(backlogs).some(f => f.includes('.corrupt-')), 'the torn text was kept')
  })
  await test('a damaged backlog file with no good copy is never overwritten', async () => {
    const path = join(backlogs, readdirSync(backlogs).find(f => f.endsWith('.json')))
    const broken = '{"inbox": [ BROKEN'
    writeFileSync(path, broken)
    writeFileSync(path + '.bak', broken)
    const r = await srv.call('backlog_add', { name: 'Anything' })
    ok(r.isError && /could not be parsed/.test(r.text), r.text)
    eq(readFileSync(path, 'utf8'), broken, 'file untouched')
    ok(readdirSync(backlogs).some(f => f.includes('.corrupt-')), 'backup written')
  })
  await test('the same project spelled differently finds the same file', async () => {
    const h2 = join(work, 'home2'), dir2 = join(h2, '.claude', 'backlogs'); mkdirSync(dir2, { recursive: true })
    const key = mod.projectKey('D:\\Work\\App')
    writeFileSync(join(dir2, key + '.json'), JSON.stringify({ nextId: 5, known: [], knownNames: [], inbox: [], boardUrl: null, cwd: 'D:\\Work\\App' }))
    process.env.BACKLOG_HOME = h2
    try { eq(mod.backlogFileFor('d:/work/app/'), join(dir2, key + '.json')) } finally { process.env.BACKLOG_HOME = home }
  })
  await test('unknown methods and tools are refused; bad JSON gets a parse error', async () => {
    eq((await srv.request('nope/method')).error.code, -32601)
    eq((await srv.request('tools/call', { name: 'rm_rf', arguments: {} })).error.code, -32602)
  })
  await test('setup writes .cursor/mcp.json and a rule, keeping other servers', async () => {
    const p = join(work, 'setup-proj'); mkdirSync(join(p, '.cursor'), { recursive: true })
    writeFileSync(join(p, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }))
    const r = mod.setup(p); ok(r.ok, r.message)
    const cfg = JSON.parse(readFileSync(join(p, '.cursor', 'mcp.json'), 'utf8'))
    eq(Object.keys(cfg.mcpServers).sort(), ['backlog', 'other'])
    eq(cfg.mcpServers.backlog.args, ['-y', 'github:kasperjunky/Backlog-Board#backlog--v' + mod.VERSION, '--project', '${workspaceFolder}'], 'pinned to this release, not a branch')
    ok(existsSync(join(p, '.cursor', 'rules', 'backlog.mdc')), 'rule written')
    writeFileSync(join(p, '.cursor', 'rules', 'backlog.mdc'), 'my edits')
    ok(mod.setup(p, { local: true }).ok)
    eq(readFileSync(join(p, '.cursor', 'rules', 'backlog.mdc'), 'utf8'), 'my edits', 'an edited rule is kept')
    eq(JSON.parse(readFileSync(join(p, '.cursor', 'mcp.json'), 'utf8')).mcpServers.backlog.command, 'node', '--local uses this file')
  })
  // ---- backlog_item / backlog_cards: the board's cards and images for Cursor ----
  // a real 1x1 PNG
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  const IMG1 = '031127c9fab4ae3c4c32c17d630d54a2', IMG2 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  function mirrorFor(proj) {
    const d = mod.mirrorDirFor(proj)
    if (!d.startsWith(home)) throw new Error('local copy folder outside the throwaway home: ' + d)
    return d
  }
  await test('card numbers parse and print the board’s way', async () => {
    eq([mod.parseCardNumber('23'), mod.parseCardNumber('#23'), mod.parseCardNumber('A1'), mod.parseCardNumber('#a999'), mod.parseCardNumber('B1'), mod.parseCardNumber('Z999'), mod.parseCardNumber('#AA1')],
       [23, 23, 1000, 1998, 1999, 26973, 26974])
    eq([mod.formatNum(999), mod.formatNum(1000), mod.formatNum(1998), mod.formatNum(1999), mod.formatNum(26974)], ['999', 'A1', 'A999', 'B1', 'AA1'])
    eq([mod.parseCardNumber('A0'), mod.parseCardNumber('A1000'), mod.parseCardNumber('hello'), mod.parseCardNumber('')], [null, null, null, null])
  })
  await test('without a local copy, the card tools say how to make one', async () => {
    ok(/no local copy/.test((await srv.call('backlog_cards')).text))
    ok(/sync the backlog for Cursor/.test((await srv.call('backlog_item', { number: '24' })).text))
  })
  await test('backlog_item returns the card’s text and its images', async () => {
    const dir = mirrorFor(project); mkdirSync(join(dir, 'images'), { recursive: true })
    writeFileSync(join(dir, 'images', IMG1 + '.png'), PNG)
    writeFileSync(join(dir, 'cards.json'), JSON.stringify({ board: 'https://claude.ai/artifact/Board123', syncedAt: '2026-11-07T15:00:00Z', cards: [
      { num: 24, id: 'bmw6hlmfz3kh', name: 'A new card for test', notes: 'Match the screenshot', priority: 'important', status: 'todo', value: 3, effort: 'M', subtasks: [{ text: 'step one', done: true }], images: [{ id: IMG1 }] },
      { num: 1000, id: 'b2', name: 'Series card', priority: 'nice', status: 'doing', images: [] },
    ] }))
    const r = await srv.request('tools/call', { name: 'backlog_item', arguments: { number: '#24' } })
    const c = r.result.content
    ok(/#24  A new card for test/.test(c[0].text) && /Match the screenshot/.test(c[0].text) && /\[x\] step one/.test(c[0].text), c[0].text)
    const img = c.find(x => x.type === 'image')
    ok(img, 'an image block is returned')
    eq([img.mimeType, img.data], ['image/png', PNG.toString('base64')])
    ok(c.some(x => x.type === 'text' && x.text.includes(join(dir, 'images', IMG1 + '.png'))), 'the file path is named too')
    ok(c.some(x => x.type === 'text' && /Look at the images above/.test(x.text)), 'told to look first')
    ok(/#A1  Series card/.test((await srv.call('backlog_item', { number: 'A1' })).text), 'lettered numbers work')
    const list = (await srv.call('backlog_cards')).text
    ok(/#24  A new card for test  \(important, to do, 1 image\)/.test(list) && /#A1  Series card/.test(list), list)
  })
  await test('a number not in the copy, or a missing image, is explained', async () => {
    ok(/#99 is not among the open cards/.test((await srv.call('backlog_item', { number: '99' })).text))
    const dir = mirrorFor(project)
    const cards = JSON.parse(readFileSync(join(dir, 'cards.json'), 'utf8')); cards.cards[0].images.push({ id: IMG2 })
    writeFileSync(join(dir, 'cards.json'), JSON.stringify(cards))
    const c = (await srv.request('tools/call', { name: 'backlog_item', arguments: { number: '24' } })).result.content
    eq(c.filter(x => x.type === 'image').length, 1, 'the present image still comes')
    ok(c.some(x => x.type === 'text' && /1 attached image\(s\) are not in the local copy/.test(x.text)), 'the missing one is reported')
  })
  await test('the local copy can never point the server at other files', async () => {
    const dir = mirrorFor(project)
    writeFileSync(join(work, 'secret.png'), PNG)
    writeFileSync(join(dir, 'cards.json'), JSON.stringify({ cards: [
      { num: 30, name: 'Sneaky', images: [{ id: '../../secret' }, { id: '..\\..\\secret' }], file: join(work, 'secret.png'), path: join(work, 'secret.png') },
    ] }))
    const c = (await srv.request('tools/call', { name: 'backlog_item', arguments: { number: '30' } })).result.content
    eq(c.filter(x => x.type === 'image').length, 0, 'no image read from outside images/')
    ok(!JSON.stringify(c).includes('secret.png'), 'no outside path mentioned')
  })
  await test('oversized images are not sent', async () => {
    const dir = mirrorFor(project)
    writeFileSync(join(dir, 'images', IMG2 + '.png'), Buffer.alloc(5 * 1024 * 1024 + 10))
    writeFileSync(join(dir, 'cards.json'), JSON.stringify({ cards: [{ num: 31, name: 'Big', images: [{ id: IMG2 }] }] }))
    const c = (await srv.request('tools/call', { name: 'backlog_item', arguments: { number: '31' } })).result.content
    eq(c.filter(x => x.type === 'image').length, 0)
  })
  await test('it starts when launched through npx (as Cursor does)', async () => {
    // npx runs the package's bin through a link/shim; the server must still start
    const { spawnSync } = await import('node:child_process')
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const r = spawnSync(npx, ['-y', ROOT, '--project', project], {
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n',
      env: Object.assign({}, process.env, { BACKLOG_HOME: home }), encoding: 'utf8', timeout: 90000, shell: process.platform === 'win32',
    })
    ok(/"id":1,"result":\{\}/.test(r.stdout || ''), 'no reply through npx; stdout=' + JSON.stringify(r.stdout) + ' stderr=' + JSON.stringify((r.stderr || '').slice(-300)))
  })
  await test('setup leaves an invalid mcp.json alone', async () => {
    const p = join(work, 'bad-proj'); mkdirSync(join(p, '.cursor'), { recursive: true })
    writeFileSync(join(p, '.cursor', 'mcp.json'), '{ not json')
    const r = mod.setup(p); ok(!r.ok && /not valid JSON/.test(r.message), r.message)
    eq(readFileSync(join(p, '.cursor', 'mcp.json'), 'utf8'), '{ not json')
  })
} finally {
  srv.stop()
  rmSync(work, { recursive: true, force: true })
}

for (const [pass, name, err] of results) console.log((pass ? '(pass) ' : '(FAIL) ') + name + (pass ? '' : '\n       ' + err))
const failed = results.filter(r => !r[0]).length
console.log('\n ' + (results.length - failed) + ' pass\n ' + failed + ' fail\nRan ' + results.length + ' MCP server tests')
process.exit(failed ? 1 : 0)
