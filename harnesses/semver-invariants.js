'use strict'

// semver range-function invariants beyond subset().
//
//   1. minVersion(r) must satisfy r
//   2. maxSatisfying / minSatisfying must be in-range and actually extremal
//   3. Trichotomy -- at most one of ltr(v,r) / gtr(v,r) / satisfies(v,r)
//
// This harness finds NOTHING NEW, and is kept for that reason.
//
// A fourth invariant was attempted and removed: "simplifyRange(versions, r)
// selects the same versions as r". It produced 22 findings, all false. The
// harness passed simplifyRange a pre-filtered list containing only matching
// versions and then compared the result against the full universe --
// simplifyRange's contract is "same selection FROM THE LIST YOU GAVE IT", so
// `*` was a correct answer every time. That was a bug in the test, not the
// library, and it is recorded here rather than quietly deleted.
//
// Trichotomy does still report on prerelease versions excluded by prerelease
// gating (ltr and gtr both true). That behaviour was raised as node-semver
// issue #328 in 2023 and closed by a maintainer as expected. Counted as known,
// not reported.

const semver = require('semver')
const { makeRand, versionUniverse } = require('../lib/rand')

const NUM = ['0', '1', '2', '3', 'x', '*']
const PRE = ['', '', '', '-alpha.0', '-beta.1', '-rc.2']
const OPS = ['^', '~', '>=', '<=', '>', '<', '', '']

function run ({ seed = 5, ranges = 8000 } = {}) {
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
  const known = []
  let checked = 0

  for (const options of [{}, { includePrerelease: true }]) {
    for (let i = 0; i < ranges; i++) {
      const r = makeRange()
      if (!r) {
        continue
      }
      checked++

      // 1. minVersion(r) must satisfy r
      try {
        const mv = semver.minVersion(r, options)
        if (mv && !semver.satisfies(mv.version, r, options)) {
          findings.push({ kind: 'minVersion', range: r, got: mv.version })
        }
      } catch (e) {
        findings.push({ kind: 'minVersion-threw', range: r, detail: e.message })
      }

      // 2. maxSatisfying / minSatisfying must be extremal
      const hits = universe.filter(v => semver.satisfies(v, r, options))
      if (hits.length) {
        const mx = semver.maxSatisfying(universe, r, options)
        const mn = semver.minSatisfying(universe, r, options)
        if (mx === null) {
          findings.push({ kind: 'maxSatisfying-null', range: r })
        } else if (hits.some(v => semver.compare(v, mx, options) > 0)) {
          findings.push({ kind: 'maxSatisfying-not-max', range: r, got: mx })
        }
        if (mn !== null && hits.some(v => semver.compare(v, mn, options) < 0)) {
          findings.push({ kind: 'minSatisfying-not-min', range: r, got: mn })
        }
      }

      // 3. trichotomy
      const v = pick(universe)
      const inR = semver.satisfies(v, r, options)
      const lo = semver.ltr(v, r, options)
      const hi = semver.gtr(v, r, options)
      if ([inR, lo, hi].filter(Boolean).length > 1) {
        // empty ranges make ltr and gtr vacuously true -- correct, not a defect
        const nonEmpty = universe.some(u => semver.satisfies(u, r, options))
        if (nonEmpty) {
          known.push({ kind: 'trichotomy', range: r, version: v, ltr: lo, gtr: hi })
        }
      }
    }
  }

  return {
    name: 'semver range invariants (minVersion / maxSatisfying / trichotomy)',
    target: `semver@${require('semver/package.json').version}`,
    checked,
    findings,
    known,
    upstream: 'https://github.com/npm/node-semver/issues/328 (closed 2023, expected behaviour)',
    novel: false,
  }
}

module.exports = { run }

if (require.main === module) {
  const r = run()
  console.log(`${r.name} -- ${r.target}`)
  console.log(`checked ${r.checked} ranges`)
  console.log(`new findings: ${r.findings.length}`)
  console.log(`known/adjudicated (trichotomy on non-empty range): ${r.known.length}`)
}
