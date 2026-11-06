// The site's two menu pages: the front page at / and the full menu at /secretfullmenu.
//
// Both share the download page's look (its wordmark header, type, surfaces and the testnet pill)
// and one shell, so they are the same page with a different list. Every destination is a whole-tile
// link with an icon, its name and one plain line saying what you do there; tiles sit in rows, one
// row per thing a visitor wants to do, with the row's heading on its left.
//
// One destination is featured as "Start here", with the only button on the page. Which one is an
// argument (`featured`, a key of DEST), not markup: the featured destination is lifted out of the
// row that lists it, so changing the argument moves it without touching the rows.
//
// The front page is public and names only the public products: the web wallet, the faucet, the
// explorer, Emissio, the Compages bridge, the staking pools and the Sequentia Core download. The
// full menu lists everything the box serves; nothing links to it, and noindex keeps a search engine
// from turning an unlinked page into a linked one. The paths themselves never change, since the
// wallets, the extension and the nodes carry them hardcoded.
const fs = require('fs')
const path = require('path')

// The download page's wordmark, inlined so the menus do not depend on what DOWNLOAD_DIR holds.
const WORDMARK = 'data:image/svg+xml;base64,' +
  fs.readFileSync(path.join(__dirname, 'downloads', 'sequentia-logo.svg')).toString('base64')

// 24x24 line icons, drawn with the tile's stroke colour.
const ICON = {
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M6 6l9-3 1.5 3"/>',
  drop: '<path d="M12 3.5s6 6.4 6 10.9a6 6 0 0 1-12 0c0-4.5 6-10.9 6-10.9z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>',
  bridge: '<path d="M2 17h20"/><path d="M4 17v-3a8 8 0 0 1 16 0v3"/><path d="M12 9v8M8 10.2V17M16 10.2V17"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5l-4.9-4.9"/><path d="M8.5 11h5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>',
  star: '<path d="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.1 6.6 20l1-6.1-4.4-4.3 6.1-.9z"/>',
  server: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4"/>',
  swap: '<path d="M4 8h15l-3.5-3.5"/><path d="M20 16H5l3.5 3.5"/>',
  percent: '<circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M19 5L5 19"/>',
  rise: '<path d="M3 20h18"/><path d="M5 16l5-5 3 3 6-7"/><path d="M15 7h4v4"/>',
  doc: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M5.8 16c.6-1.3 1.8-2 3.2-2s2.6.7 3.2 2"/><path d="M14.5 10h4M14.5 13.5h3"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/><path d="M4 18h16"/>',
  box: '<path d="M3 7.5l9-4.5 9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
}

// Every destination: its path, its name, one line on what you do there, and its icon. `button` is
// the label used when it is the featured destination.
const DEST = {
  wallet: { href: '/wallet/', name: 'Web wallet', icon: 'wallet', button: 'Open the web wallet',
    line: 'Hold, send, trade and stake BTC and every Sequentia asset.' },
  faucet: { href: '/faucet', name: 'Faucet', icon: 'drop', line: 'Free test BTC and Sequentia assets for any wallet.' },
  bridge: { href: '/bridge/', name: 'Compages', icon: 'bridge', line: 'Bring assets in from Ethereum, Bitcoin and Solana.' },
  explorer: { href: '/explorer/', name: 'Block explorer', icon: 'search', line: 'Look up any block, transaction or asset.' },
  pools: { href: '/pools/', name: 'Staking pools', icon: 'layers', line: 'Compare block producers and pick one to stake with.' },
  emissio: { href: '/emissio/', name: 'Emissio', icon: 'star', button: 'Open Emissio',
    line: 'Earn the Sequence token (SEQ) by testing the network.' },
  core: { href: '/download/core/', name: 'Sequentia Core', icon: 'server', line: 'Download the full node and desktop wallet.' },
  dex: { href: '/dex/', name: 'SeqDEX', icon: 'swap', line: 'Swap BTC and assets directly with other people.' },
  lending: { href: '/lending/', name: 'Pignus', icon: 'percent', line: 'Borrow one asset against another.' },
  levo: { href: '/levo/', name: 'Levo', icon: 'rise', line: 'Back new projects, or raise funds for your own.' },
  seqpal: { href: '/seqpal/', name: 'SeqPal', icon: 'doc', line: 'Issue and manage compliant securities. A proof of concept.' },
  seqpalId: { href: '/seqpal/id', name: 'SeqPal ID', icon: 'id', line: 'One verified identity for holding SeqPal assets.' },
  liquidity: { href: '/liquidity', name: 'Inbound liquidity', icon: 'gauge', line: 'Funds lent to wallets so they can receive payments.' },
  downloads: { href: '/download/', name: 'Downloads', icon: 'box', line: 'Every app to install: wallets, the full node and more.' },
}

const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`
const tile = (d) => `<a class="tile" href="${d.href}"><span class="ic">${svg(d.icon)}</span><span class="tx"><b>${d.name}</b><span>${d.line}</span></span></a>`
const featuredTile = (d) => `<a class="tile featured" href="${d.href}"><span class="ic">${svg(d.icon)}</span><span class="tx"><b>${d.name}</b><span>${d.line}</span></span><span class="btn">${d.button}</span></a>`

const menuPage = ({ heading, groups, featured, noindex }) => {
  const rows = groups.map(([label, keys]) => [label, keys.filter((k) => k !== featured)]).filter(([, keys]) => keys.length)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sequentia: testnet demo server</title>${noindex ? '\n<meta name="robots" content="noindex">' : ''}
<link rel="icon" href="/explorer/img/icons/SequentiaTestnet-menu-logo.svg">
<style>
  :root{ --ground:#101317; --panel:#161a20; --raise:#1c2129; --line:#2a3039; --txt:#eef1f4; --dim:#9aa3ad;
         --gold:#ffc629; --gold-ink:#1d1600; color-scheme:dark }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--ground);color:var(--txt);
       font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--gold)}
  .wrap{max-width:1180px;margin:0 auto;padding:44px 32px 48px}
  header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:14px 32px;margin:0 0 30px}
  .brand{height:38px;width:auto;display:block}
  h1{font-size:40px;line-height:1.1;margin:22px 0 8px;letter-spacing:-.025em;font-weight:700}
  .sub{color:var(--dim);margin:0;max-width:62ch}
  .chain{display:inline-block;padding:5px 12px;border:1px solid var(--line);border-radius:999px;
         color:var(--gold);font-size:13px;white-space:nowrap}
  .row{display:grid;grid-template-columns:205px minmax(0,1fr);gap:12px 24px;padding:18px 0;border-top:1px solid var(--line)}
  .row h2{margin:0;padding-top:13px;font-size:15px;line-height:1.35;font-weight:600;color:var(--dim)}
  .row.start h2{color:var(--gold)}
  .tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
  .tile{display:flex;align-items:flex-start;gap:14px;min-width:0;padding:15px 16px;background:var(--panel);
        border:1px solid var(--line);border-radius:12px;color:var(--txt);text-decoration:none;transition:border-color .12s ease}
  .tile:hover{border-color:var(--gold)}
  .tile:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
  .ic{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--raise);border:1px solid var(--line)}
  .ic svg{width:22px;height:22px;fill:none;stroke:var(--gold);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .tx{display:flex;flex-direction:column;min-width:0}
  .tx b{font-size:17px;line-height:1.3;font-weight:600;letter-spacing:-.005em}
  .tx span{color:var(--dim);font-size:14px;line-height:1.45;margin-top:3px}
  .tile.featured{grid-column:1/-1;align-items:center;gap:18px;padding:20px 22px;border-color:var(--gold)}
  .featured .ic{width:48px;height:48px;border-radius:12px;background:var(--gold);border-color:var(--gold)}
  .featured .ic svg{width:26px;height:26px;stroke:var(--gold-ink);stroke-width:1.8}
  .featured .tx b{font-size:21px;letter-spacing:-.01em}
  .featured .tx span{color:var(--txt);font-size:15px}
  .btn{margin-left:auto;flex:none;padding:11px 18px;border-radius:10px;background:var(--gold);color:var(--gold-ink);
       font-weight:600;font-size:15px;white-space:nowrap}
  footer{margin-top:6px;padding-top:20px;border-top:1px solid var(--line);color:var(--dim);font-size:14px;
         display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
  footer a{text-decoration:none}
  .by-logo{height:15px;width:auto;vertical-align:middle;opacity:.9;margin-left:5px}
  @media (max-width:900px){
    .row{grid-template-columns:1fr}
    .row h2{padding-top:0}
    .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  }
  @media (max-width:600px){
    .wrap{padding:28px 16px 36px}
    h1{font-size:32px;margin-top:18px}
    header{margin-bottom:22px}
    .row{padding:16px 0;gap:10px}
    .tiles{grid-template-columns:1fr;gap:10px}
    .tile{padding:13px 14px}
    .tile.featured{flex-wrap:wrap;padding:16px}
    .featured .tx{flex:1 1 0}
    .btn{flex-basis:100%;text-align:center;margin-left:0}
  }
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><div class="wrap">
  <header>
    <div>
      <img class="brand" src="${WORDMARK}" alt="Sequentia" height="38">
      <h1>${heading}</h1>
      <p class="sub">Sequentia is a Bitcoin sidechain for asset tokenization and disintermediated exchanges.
        Everything here runs on its public testnet.</p>
    </div>
    <span class="chain">Testnet: coins and assets have no value</span>
  </header>
  <main>${featured ? `
    <section class="row start"><h2>Start here</h2><div class="tiles">
      ${featuredTile(DEST[featured])}
    </div></section>` : ''}
${rows.map(([label, keys]) => `    <section class="row"><h2>${label}</h2><div class="tiles">
${keys.map((k) => `      ${tile(DEST[k])}`).join('\n')}
    </div></section>`).join('\n')}
  </main>
  <footer>
    <span>Built by <a href="https://concatenalabs.com" target="_blank" rel="noopener"><img class="by-logo" src="/explorer/img/icons/concatena-labs.png" alt="Concatena Labs"></a></span>
    <a href="https://sequentia.io" target="_blank" rel="noopener">sequentia.io</a>
  </footer>
</div></body></html>`
}

// The public front door. To start visitors somewhere else, change `featured`.
const ROOT = {
  heading: 'Testnet',
  featured: 'emissio',
  groups: [
    ['Wallet and test coins', ['wallet', 'faucet', 'bridge']],
    ['Explore, stake and run a node', ['explorer', 'pools', 'core']],
    ['Earn', ['emissio']],
  ],
}
// Everything the box serves.
const FULL_MENU = {
  heading: 'Everything on the testnet',
  featured: 'emissio',
  noindex: true,
  groups: [
    ['Wallets and coins', ['wallet', 'faucet', 'bridge']],
    ['Trade and borrow', ['dex', 'lending', 'liquidity']],
    ['Issue and raise', ['seqpal', 'seqpalId', 'levo']],
    ['Explore, stake and download', ['explorer', 'pools', 'downloads']],
    ['Earn', ['emissio']],
  ],
}

const ROOT_HTML = menuPage(ROOT)
const FULL_MENU_HTML = menuPage(FULL_MENU)

module.exports = { DEST, ROOT, FULL_MENU, menuPage, ROOT_HTML, FULL_MENU_HTML }
