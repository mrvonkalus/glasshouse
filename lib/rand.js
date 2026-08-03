'use strict'

// Seeded xorshift32. Deterministic across platforms and node versions, so every
// finding in this repo reproduces exactly rather than "usually".
function makeRand (seed = 1) {
  let s = seed >>> 0 || 1
  const rnd = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
  return {
    rnd,
    int: (n) => Math.floor(rnd() * n),
    pick: (arr) => arr[Math.floor(rnd() * arr.length)],
  }
}

// A finite universe of semver versions, including prereleases -- prereleases are
// where most range-algebra defects live.
function versionUniverse (maxMajor = 3, maxMinor = 2, maxPatch = 2) {
  const out = []
  for (let M = 0; M <= maxMajor; M++) {
    for (let m = 0; m <= maxMinor; m++) {
      for (let p = 0; p <= maxPatch; p++) {
        out.push(`${M}.${m}.${p}`)
        for (const pre of ['alpha.0', 'beta.1', 'rc.2']) {
          out.push(`${M}.${m}.${p}-${pre}`)
        }
      }
    }
  }
  return out
}

module.exports = { makeRand, versionUniverse }
