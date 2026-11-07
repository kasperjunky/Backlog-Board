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
    eq(list.result.tools.map(t => t.name), ['backlog_add', 'backlog_inbox', 'backlog_board'])
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
  await test('a damaged backlog file is never overwritten', async () => {
    const path = join(backlogs, readdirSync(backlogs).find(f => f.endsWith('.json')))
    const broken = '{"inbox": [ BROKEN'
    writeFileSync(path, broken)
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
    try { eq(mod.backlogFileFor('d:/work/app/'), join(dir2, key + '.json')) } finally { delete process.env.BACKLOG_HOME }
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
    eq(cfg.mcpServers.backlog.args, ['-y', 'github:kasperjunky/Backlog-Board', '--project', '${workspaceFolder}'])
    ok(existsSync(join(p, '.cursor', 'rules', 'backlog.mdc')), 'rule written')
    writeFileSync(join(p, '.cursor', 'rules', 'backlog.mdc'), 'my edits')
    ok(mod.setup(p, { local: true }).ok)
    eq(readFileSync(join(p, '.cursor', 'rules', 'backlog.mdc'), 'utf8'), 'my edits', 'an edited rule is kept')
    eq(JSON.parse(readFileSync(join(p, '.cursor', 'mcp.json'), 'utf8')).mcpServers.backlog.command, 'node', '--local uses this file')
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
