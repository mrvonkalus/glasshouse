'use strict'

// semver.subset() soundness.
//
// Property:  subset(a, b) === true  =>  no version satisfies `a` but not `b`.
//
// Only that direction is checked. subset() quantifies over all possible
// versions while this walks a finite universe, so a `false` result can never be
// refuted here -- but a `true` result can be, and the false-positive is the
// dangerous direction: it tells a caller a range is contained when it is not.
//
// FINDING IS NOT NOVEL -- see README. Reported upstream 2026-07-23 as
// https://github.com/npm/node-semver/pull/889 (open). Rediscovered here
// independently on 2026-08-03; the tracker was checked afterwards.

const semver = require('semver')
const { makeRand, versionUniverse } = require('../lib/rand')

const NUM = ['0', '1', '2', '3', 'x', '*']
const PRE = ['', '', '', '-alpha.0', '-beta.1', '-rc.2']
const OPS = ['^', '~', '>=', '<=', '>', '<', '', '']

function run ({ seed = 11, pairs = 20000 } = {}) {
  const { rnd, pick } = makeRand(seed)
  const universe = versionUniverse()

  const simple = () =>
    `${pick(OPS)}${pick(NUM)}.${pick(NUM)}.${pick(NUM)}${pick(PRE)}`

  const makeRange = () => {
    const r = rnd()
    const out = r < 0.45 ? simple()
      : r < 0.75 ? `${simple()} ${simple()}`
        : `${simple()} || ${simple()}`
    return semver.validRange(out) === null ? null : out
  }

  const findings = []
  let checked = 0

  for (const options of [{}, { includePrerelease: true }]) {
    for (let i = 0; i < pairs && findings.length < 8; i++) {
      const sub = makeRange()
      const dom = makeRange()
      if (!sub || !dom) {
        continue
      }
      checked++
      let claimed
      try {
        claimed = semver.subset(sub, dom, options)
      } catch {
        continue
      }
      if (claimed !== true) {
        continue
      }
      const witness = universe.find(v =>
        semver.satisfies(v, sub, options) && !semver.satisfies(v, dom, options))
      if (witness !== undefined) {
        findings.push({
          sub,
          dom,
          witness,
          includePrerelease: !!options.includePrerelease,
          detail: `subset(${JSON.stringify(sub)}, ${JSON.stringify(dom)}) === true, ` +
                  `but ${witness} satisfies the sub-range and not the super-range`,
        })
      }
    }
  }

  return {
    name: 'semver.subset() soundness',
    target: `semver@${require('semver/package.json').version}`,
    checked,
    findings,
    upstream: 'https://github.com/npm/node-semver/pull/889 (open, filed 2026-07-23)',
    novel: false,
  }
}

module.exports = { run }

if (require.main === module) {
  const r = run()
  console.log(`${r.name} -- ${r.target}`)
  console.log(`checked ${r.checked} range pairs; unsound results: ${r.findings.length}\n`)
  for (const f of r.findings) {
    console.log('  ' + f.detail)
  }
}
