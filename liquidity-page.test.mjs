// The /liquidity page: served by serve-public.js, listed on the full menu, and built from the LSP's
// public figures as text, never as markup (asset names come from node labels).
//
//   node --test liquidity-page.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const serve = readFileSync(new URL('./serve-public.js', import.meta.url), 'utf8')
const page = readFileSync(new URL('./liquidity.html', import.meta.url), 'utf8')
const { ROOT_HTML, FULL_MENU_HTML } = createRequire(import.meta.url)('./menus.js')

test('the page is served at /liquidity, before the catch-all, and listed on the full menu only', () => {
  const route = serve.indexOf("app.get('/liquidity'"), catchAll = serve.indexOf("app.get('*'")
  assert.ok(route > 0 && route < catchAll)
  assert.match(FULL_MENU_HTML, /href="\/liquidity"/)
  assert.ok(!ROOT_HTML.includes('href="/liquidity"'))
})

test('it reads the LSP public stats and writes them as text', () => {
  assert.match(page, /fetch\('\/lsp\/stats\/inbound'/)
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(page), 'no markup built from data')
})
