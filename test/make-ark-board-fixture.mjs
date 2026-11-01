// Makes test/fixtures/ark-board.json from the Arca covenant's golden vectors for a board
// (arca `regtest/vectors/transactions.json`, `board`): its funding transaction and the
// owner's conversion, decoded into the shape the explorer API answers a transaction in,
// with the record's leaf id. The vectors are raw Elements transactions; this decodes the
// explicit kind they are (no confidential amounts).
//
//   node test/make-ark-board-fixture.mjs <path to arca>/regtest/vectors/transactions.json
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const sha256d = b => createHash('sha256').update(createHash('sha256').update(b).digest()).digest()

const decode = hex => {
  const b = Buffer.from(hex, 'hex')
  let i = 0
  const take = n => { const s = b.subarray(i, i + n); i += n; return s }
  const varint = () => {
    const f = b[i++]
    if (f < 0xfd) return f
    if (f == 0xfd) { const v = b.readUInt16LE(i); i += 2; return v }
    if (f == 0xfe) { const v = b.readUInt32LE(i); i += 4; return v }
    throw new Error('varint too large')
  }
  const bytes = () => take(varint())
  const confValue = () => { const p = b[i]; return p == 0 ? take(1) : p == 1 ? take(9) : take(33) }
  const start = i
  take(4)
  const flags = b[i++]
  const vin = [], vout = []
  const nin = varint()
  for (let k = 0; k < nin; k++) {
    const txid = Buffer.from(take(32)).reverse().toString('hex')
    let vout_ = b.readUInt32LE(i); i += 4
    const issuance = !!(vout_ & 0x80000000)
    vout_ &= 0x3fffffff
    bytes()
    take(4)
    if (issuance) { take(64); confValue(); confValue() }
    vin.push({ txid, vout: vout_, witness: [] })
  }
  const nout = varint()
  for (let k = 0; k < nout; k++) {
    const a = b[i] == 1 ? take(33) : b[i] == 0 ? take(1) : take(33)
    const v = confValue()
    b[i] == 0 ? take(1) : take(33)
    const spk = bytes()
    vout.push({
      scriptpubkey: spk.toString('hex'),
      asset: a.length == 33 && a[0] == 1 ? Buffer.from(a.subarray(1)).reverse().toString('hex') : null,
      value: v.length == 9 && v[0] == 1 ? Number(v.readBigUInt64BE(1)) : null,
    })
  }
  take(4)
  const end = i
  if (flags & 1) {
    for (const input of vin) {
      bytes(); bytes()
      const n = varint()
      for (let k = 0; k < n; k++) input.witness.push(bytes().toString('hex'))
      const p = varint()
      for (let k = 0; k < p; k++) bytes()
    }
    for (let k = 0; k < nout; k++) { bytes(); bytes() }
  }
  // The txid covers the transaction with its flags byte zeroed and no witness.
  const bare = Buffer.concat([b.subarray(start, start + 4), Buffer.from([0]), b.subarray(start + 5, end)])
  return { txid: Buffer.from(sha256d(bare)).reverse().toString('hex'), vin, vout }
}

const withPrevouts = (tx, inputs) => {
  inputs.forEach((x, k) => {
    if (x.outpoint.txid != tx.vin[k].txid || x.outpoint.vout != tx.vin[k].vout) throw new Error('input order')
    tx.vin[k].prevout = { scriptpubkey: x.spent.script_pubkey, asset: x.spent.asset, value: x.spent.value }
  })
  return tx
}

const v = JSON.parse(readFileSync(process.argv[2], 'utf8')).board
const funding = withPrevouts(decode(v.board_tx.tx), v.board_tx.inputs)
const conversion = withPrevouts(decode(v.conversion_tx.tx), v.conversion_tx.inputs)
writeFileSync(new URL('./fixtures/ark-board.json', import.meta.url), JSON.stringify({
  about: 'The Arca covenant golden vectors of a board (arca regtest/vectors/transactions.json, board), decoded by test/make-ark-board-fixture.mjs.',
  leaf_id: v.record.leaf_id, board_script_pubkey: v.record.script_pubkey, leaf_script_pubkey: v.record.leaf_script_pubkey,
  board_vout: v.board_tx.board_vout, funding, conversion,
}, null, 1))
console.log(funding.txid, conversion.txid, conversion.vin[0].txid)
