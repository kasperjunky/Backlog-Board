#!/usr/bin/env node
// Build the exact file to publish as the board artifact:
//   the standard artifact skeleton + board.html + </body></html>
//
// board.html is written without <!doctype>/<head> (the Artifact tool used to
// add them). Publishing paths that serve bytes as-is need the skeleton added,
// or the page drops into quirks mode. The skeleton is read from
// hooks/register.tsx (SKELETON_OPEN) so the mod's instructions and this
// script can never drift apart.
//
//   node scripts/build-publish.mjs            -> dist/board.publish.html
//   node scripts/build-publish.mjs out.html   -> out.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The skeleton string, evaluated from its source in register.tsx (a sum of
// plain string literals, so it is parsed rather than executed as code).
export function skeletonOpen() {
  const src = readFileSync(join(ROOT, 'hooks', 'register.tsx'), 'utf8')
  const m = src.match(/const SKELETON_OPEN =([\s\S]*?)\n\n/)
  if (!m) throw new Error('SKELETON_OPEN not found in hooks/register.tsx')
  const parts = m[1].match(/'(?:[^'\\]|\\.)*'/g)
  if (!parts) throw new Error('SKELETON_OPEN has no string parts')
  return parts.map(p => p.slice(1, -1).replace(/\\(.)/g, '$1')).join('')
}

// Wrap page content (board.html, optionally with test scripts) for publishing.
export function wrapPage(content) {
  return skeletonOpen() + content + '</body></html>'
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const out = resolve(process.argv[2] || join(ROOT, 'dist', 'board.publish.html'))
  const html = wrapPage(readFileSync(join(ROOT, 'board.html'), 'utf8'))
  if (!html.startsWith('<!doctype html>')) throw new Error('built page does not start with a doctype')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, html)
  console.log('built ' + out + ' (' + html.length + ' bytes)')
}
