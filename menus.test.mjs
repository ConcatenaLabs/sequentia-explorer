// The two menu pages (menus.js): every path each one has always linked is still there, the
// featured destination is linked once, and the public front page names no hidden product.
//
//   node --test menus.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { DEST, ROOT, FULL_MENU, menuPage, ROOT_HTML, FULL_MENU_HTML } = require('./menus.js')
const serve = readFileSync(new URL('./serve-public.js', import.meta.url), 'utf8')

const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.endsWith('.svg'))
const count = (html, href) => hrefs(html).filter((h) => h === href).length
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ')

// The paths the wallets, the extension, the nodes and returning visitors rely on.
const ROOT_PATHS = ['/wallet/', '/faucet', '/explorer/', '/emissio/', '/bridge/', '/pools/', '/download/core/']
const FULL_PATHS = ['/explorer/', '/wallet/', '/pools/', '/dex/', '/faucet', '/emissio/', '/bridge/', '/lending/',
  '/levo/', '/seqpal/', '/seqpal/id', '/liquidity', '/download/']
const FOOTER = ['https://concatenalabs.com', 'https://sequentia.io']

test('serve-public.js serves the two pages', () => {
  assert.match(serve, /app\.get\('\/', \(req, res\) => res\.type\('html'\)\.send\(ROOT_HTML\)\)/)
  assert.match(serve, /app\.get\('\/secretfullmenu', \(req, res\) => res\.type\('html'\)\.send\(FULL_MENU_HTML\)\)/)
})

test('every path stays, and the front page links nothing else', () => {
  assert.deepStrictEqual(new Set(hrefs(ROOT_HTML)), new Set([...ROOT_PATHS, ...FOOTER]))
  assert.deepStrictEqual(new Set(hrefs(FULL_MENU_HTML)), new Set([...FULL_PATHS, ...FOOTER]))
})

test('each destination is linked once, the featured one as the only button', () => {
  for (const [html, paths] of [[ROOT_HTML, ROOT_PATHS], [FULL_MENU_HTML, FULL_PATHS]]) {
    for (const p of paths) assert.strictEqual(count(html, p), 1, p)
    assert.strictEqual((html.match(/class="tile featured"/g) || []).length, 1)
    assert.strictEqual((html.match(/class="btn"/g) || []).length, 1)
    assert.match(html, /<a class="tile featured" href="\/wallet\/">/)
  }
})

test('the featured destination is an argument: moving it keeps every destination, once', () => {
  const html = menuPage({ ...ROOT, featured: 'emissio' })
  assert.match(html, /<a class="tile featured" href="\/emissio\/">/)
  for (const p of ROOT_PATHS) assert.strictEqual(count(html, p), 1, p)
  assert.match(html, /<span class="btn">Open Emissio<\/span>/)
})

test('the front page names no hidden product; the full menu is noindex and the front page is not', () => {
  const t = text(ROOT_HTML)
  for (const name of ['Ambra', 'SeqDEX', 'Fulmen', 'SeqLN', 'Pignus', 'Levo', 'SeqPal', 'Seqognito', 'Lightning', 'Arca'])
    assert.ok(!t.includes(name), name)
  assert.match(FULL_MENU_HTML, /<meta name="robots" content="noindex">/)
  assert.ok(!ROOT_HTML.includes('noindex'))
})

test('the copy: one short plain line per tile, the network described with "a", no dashes or arrows', () => {
  for (const d of Object.values(DEST)) {
    assert.ok(d.line.split(/\s+/).length <= 10, d.name)
    assert.ok(!/[—–→]|\bSEQ chain\b|decentrali[sz]ed/.test(d.name + d.line), d.name)
  }
  for (const html of [ROOT_HTML, FULL_MENU_HTML]) {
    assert.match(text(html), /a Bitcoin sidechain for asset tokenization and disintermediated exchanges/)
    assert.ok(!/[—–→]/.test(text(html)))
  }
  for (const g of [...ROOT.groups, ...FULL_MENU.groups]) for (const k of g[1]) assert.ok(DEST[k], k)
})
