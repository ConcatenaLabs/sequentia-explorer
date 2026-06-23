import menu from './navbar-menu'
import { refOptions, REF } from './util'

const staticRoot = process.env.STATIC_ROOT || ''

// SEQUENTIA: the explorer-wide reference-currency picker. Lives in the header so it
// governs every page; changing it persists to localStorage and reloads (handled in
// app.js) so every displayed amount re-denominates into the chosen reference.
const refPicker = S => !process.env.IS_ELEMENTS ? '' :
  <div className="ref-ccy-picker" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
    <span style={{ opacity: '0.7', fontSize: '0.85em' }}>Show values in</span>
    <select id="refCcySel" name="refCcy">
      { refOptions(S.prices).map(o => <option value={o} attrs={ o === REF ? { selected: true } : {} }>{o}</option>) }
    </select>
  </div>

export default S =>

  <nav className="container nav-container">
      <a className="navbar-brand" href=".">
        <img src={`${staticRoot}img/icons/concatena-labs.png`} alt="Concatena Labs"></img>
      </a>
        <div className="sub-nav font-h5">
            <a href="." class={{ active: S.activeTab == 'dashBoard' }}>Dashboard</a>
            <a href="blocks/recent" class={{ active: S.activeTab == 'recentBlocks' }}>Blocks</a>
            <a href="tx/recent" class={{ active: S.activeTab == 'recentTxs' }}>Transactions</a>
            { process.env.IS_ELEMENTS ? <a href="assets" class={{ active: S.activeTab == 'assets' }}>Assets<sup className="highlight"></sup></a> : "" }
            <a href="/explorer-api" class={{ active: S.activeTab == 'apiLanding' }}>Explorer API</a>
        </div>
      { refPicker(S) }
      { menu(S) }
  </nav>

