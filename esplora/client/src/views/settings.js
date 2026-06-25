import layout from './layout'
import { refOptions, REF } from './util'

// SEQUENTIA Settings page. Local-only display preferences (stored in this browser's
// localStorage; nothing is sent to the server). The reference-currency picker lives
// here now (moved out of the navbar). Change handlers + live application are wired in
// app.js; util.js reads the number/time/currency keys, app.js applies theme/font/size.
const lsGet = (k, d = '') => (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || d

const opt = (val, label, cur) =>
  <option value={val} attrs={ val === cur ? { selected: true } : {} }>{label}</option>

const row = (name, hint, control) =>
  <div className="set-row">
    <div className="set-label">
      <div className="set-name">{name}</div>
      { hint ? <div className="set-hint text-gray">{hint}</div> : '' }
    </div>
    <div className="set-control">{control}</div>
  </div>

const SettingsPage = ({ t, ...S }) => {
  const theme    = lsGet('seqTheme', 'auto')
  const font     = lsGet('seqFont', 'system')
  const textsize = lsGet('seqTextSize', 'normal')
  const numfmt   = lsGet('seqNumFmt', 'plain')
  const dateutc  = lsGet('seqDateUTC', '0')

  return layout(
    <div className="container settings-page">
      <h1 className="font-h2">Settings</h1>
      <p className="set-intro text-gray">These preferences are stored only in this browser and change how the explorer
        <b> displays</b> data; nothing is sent to the server. They apply everywhere in the explorer.</p>

      <div className="settings-card">
        { row('Show values in',
            'Alongside each amount, the explorer shows an approximate value in this currency.',
            <select id="set-refccy">{ refOptions(S.prices).map(o => opt(o, o, REF)) }</select>) }

        { row('Number format',
            'How numbers are grouped and punctuated.',
            <select id="set-numfmt">
              { opt('plain',    '1234.56 (plain)', numfmt) }
              { opt('grouped',  '1,234.56 grouped (comma)', numfmt) }
              { opt('european', '1.234,56 (European)', numfmt) }
            </select>) }

        { row('Times',
            'Show block and transaction timestamps in your local timezone, or in UTC.',
            <select id="set-datefmt">
              { opt('0', 'Local time', dateutc) }
              { opt('1', 'UTC', dateutc) }
            </select>) }

        { row('Theme',
            'Light, dark, or follow your operating system setting.',
            <select id="set-theme">
              { opt('auto',  'Auto (match system)', theme) }
              { opt('light', 'Light', theme) }
              { opt('dark',  'Dark', theme) }
            </select>) }

        { row('Font',
            'The typeface used throughout the explorer.',
            <select id="set-font">
              { opt('system', 'System default', font) }
              { opt('sans',   'Sans-serif', font) }
              { opt('serif',  'Serif', font) }
              { opt('mono',   'Monospace', font) }
            </select>) }

        { row('Text size',
            'Make all text smaller or larger.',
            <select id="set-textsize">
              { opt('sm',     'Small', textsize) }
              { opt('normal', 'Normal', textsize) }
              { opt('lg',     'Large', textsize) }
              { opt('xl',     'Larger', textsize) }
            </select>) }
      </div>
    </div>
    , { t, activeTab: 'settings', ...S })
}

export default SettingsPage
