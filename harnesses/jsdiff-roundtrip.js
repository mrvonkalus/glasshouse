'use strict'

// jsdiff patch round-trip.
//
// Property:  applyPatch(a, createPatch(a, b)) === b
//
// If that ever fails, the library silently produced a patch that corrupts a
// file -- no error, no crash, just wrong content.
//
// This harness finds NOTHING, and is kept for that reason. The input alphabet
// is deliberately loaded with lines that look like patch syntax ("---", "+++",
// "@@", "\ No newline at end of file"), which is where this class of library
// usually breaks. jsdiff survives it, across four separate invariants and four
// context settings. A hunt log that only lists hits is worthless.

const D = require('diff')
const { makeRand } = require('../lib/rand')

const LINES = [
  'a', 'b', 'c', 'hello', 'world',
  '', ' ', '  ',
  '-', '+', '--', '++', '---', '+++', '----', '@@',
  '@@ -1,1 +1,1 @@', '\\', '\\ No newline at end of file',
  'Index: x', '===', '-foo', '+foo', ' foo',
  '\t', 'é', '👍',
]

const INVARIANTS = {
  forward (a, b, o) {
    const p = D.createPatch('f', a, b, undefined, undefined, o)
    return D.applyPatch(a, p) === b ? null : 'applyPatch(a, patch(a,b)) !== b'
  },
  reverse (a, b, o) {
    const p = D.createPatch('f', a, b, undefined, undefined, o)
    const got = D.applyPatch(b, D.reversePatch(D.parsePatch(p)))
    return got === a ? null : 'applyPatch(b, reverse(patch(a,b))) !== a'
  },
  reparse (a, b, o) {
    const p = D.createPatch('f', a, b, undefined, undefined, o)
    return D.applyPatch(a, D.parsePatch(p)) === b ? null : 'applyPatch(a, parsePatch(p)) !== b'
  },
  formatStable (a, b, o) {
    const p = D.createPatch('f', a, b, undefined, undefined, o)
    return D.formatPatch(D.parsePatch(p)) === p ? null : 'formatPatch(parsePatch(p)) !== p'
  },
}

function run ({ seed = 7, cases = 20000 } = {}) {
  const { rnd, int, pick } = makeRand(seed)

  const makeText = () => {
    const n = int(6)
    const lines = []
    for (let i = 0; i < n; i++) {
      lines.push(pick(LINES))
    }
    let s = lines.join('\n')
    if (s.length && rnd() < 0.5) {
      s += '\n'
    }
    return s
  }

  const findings = []
  let checked = 0

  for (const context of [undefined, 0, 1, 2]) {
    const o = context === undefined ? undefined : { context }
    for (let i = 0; i < cases && findings.length < 8; i++) {
      const a = makeText()
      const b = makeText()
      checked++
      for (const [name, fn] of Object.entries(INVARIANTS)) {
        let msg
        try {
          msg = fn(a, b, o)
        } catch (e) {
          msg = 'threw: ' + e.message
        }
        if (msg) {
          findings.push({ invariant: name, context, a, b, detail: msg })
          break
        }
      }
    }
  }

  return {
    name: 'jsdiff patch round-trip (4 invariants x 4 context settings)',
    target: `diff@${require('diff/package.json').version}`,
    checked,
    findings,
    upstream: null,
    novel: false,
  }
}

module.exports = { run }

if (require.main === module) {
  const r = run()
  console.log(`${r.name} -- ${r.target}`)
  console.log(`checked ${r.checked} text pairs; failures: ${r.findings.length}`)
  if (!r.findings.length) {
    console.log('clean.')
  }
}
