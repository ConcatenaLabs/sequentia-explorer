// The /liquidity page: served by serve-public.js, listed on the full menu, and built from the LSP's
// public figures as text, never as markup (asset names come from node labels).
//
//   node --test liquidity-page.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const serve = readFileSync(new URL('./serve-public.js', import.meta.url), 'utf8')
const page = readFileSync(new URL('./liquidity.html', import.meta.url), 'utf8')

test('the page is served at /liquidity, before the catch-all, and listed on the full menu only', () => {
  const route = serve.indexOf("app.get('/liquidity'"), catchAll = serve.indexOf("app.get('*'")
  assert.ok(route > 0 && route < catchAll)
  const full = serve.slice(serve.indexOf('const FULL_MENU_HTML'), serve.indexOf("app.get('/',"))
  assert.match(full, /CARD\.liquidity/)
  assert.ok(!/CARD\.liquidity/.test(serve.slice(serve.indexOf('const ROOT_HTML'), serve.indexOf('const FULL_MENU_HTML'))))
})

test('it reads the LSP public stats and writes them as text', () => {
  assert.match(page, /fetch\('\/lsp\/stats\/inbound'/)
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(page), 'no markup built from data')
})
