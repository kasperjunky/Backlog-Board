#!/usr/bin/env node
// Run the board's behaviour tests in headless Chrome/Edge — no npm packages.
//
// Builds one page (artifact skeleton + tests/board/mock-db.js + board.html +
// tests/board/board.spec.js) in a temp folder, opens it with a throwaway
// browser profile and no network, and reads the JSON the spec writes.
//
//   node scripts/test-board.mjs
//   CHROME_PATH=/path/to/chrome node scripts/test-board.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, wrapPage } from './build-publish.mjs'

function findBrowser() {
  const env = process.env.CHROME_PATH
  if (env) return env
  const candidates = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
  }[process.platform] || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
  return candidates.find(p => existsSync(p))
}

const browser = findBrowser()
if (!browser) {
  console.error('test-board: no Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser.')
  process.exit(2)
}

const read = p => readFileSync(join(ROOT, p), 'utf8')
const page = wrapPage(
  '<script>' + read('tests/board/mock-db.js') + '</script>\n' +
  read('board.html') + '\n' +
  '<script>' + read('tests/board/board.spec.js') + '</script>\n')

const dir = mkdtempSync(join(tmpdir(), 'board-test-'))
let code = 1
try {
  const file = join(dir, 'board.test.html')
  writeFileSync(file, page)
  const run = spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--user-data-dir=' + join(dir, 'profile'),
    '--host-resolver-rules=MAP * ~NOTFOUND', // offline: web fonts fall back
    '--virtual-time-budget=30000', '--dump-dom', pathToFileURL(file).href,
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 })

  // the element the spec appends (hidden), not the mention in its own comments
  const m = (run.stdout || '').match(/<pre id="test-results" hidden[^>]*>([\s\S]*?)<\/pre>/)
  if (!m) {
    console.error('test-board: no results from the browser (exit ' + run.status + ').')
    if (run.error) console.error(String(run.error))
    console.error((run.stderr || '').split('\n').slice(-15).join('\n'))
    process.exit(1)
  }
  const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  const results = JSON.parse(unescape(m[1]))
  for (const r of results) console.log((r.ok ? '(pass) ' : '(FAIL) ') + r.name + (r.ok ? '' : '\n       ' + r.error))
  const failed = results.filter(r => !r.ok).length
  console.log('\n ' + (results.length - failed) + ' pass\n ' + failed + ' fail\nRan ' + results.length + ' board tests in ' + browser.split(/[\\/]/).pop())
  code = failed ? 1 : 0
} finally {
  rmSync(dir, { recursive: true, force: true })
}
process.exit(code)
