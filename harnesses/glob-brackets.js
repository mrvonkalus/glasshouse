'use strict'

// minimatch vs picomatch -- differential test.
//
// Two independent implementations of the same glob spec. When they disagree,
// one of them is wrong; no invented oracle is required. That is the advantage
// of differential testing over property testing: you cannot get the rule wrong,
// because you never write one down.
//
// Paths deliberately contain no empty segments. Empty segments produce trailing
// slashes, double slashes, and empty paths, where these two libraries diverge by
// documented design rather than by defect. Including them floods the output with
// ~400 non-findings -- which is exactly what happened on the first run here.
//
// FINDING IS NOT NOVEL -- see README. Already reported on picomatch as
// issues #187, #180 and #188 (all open). Rediscovered independently.

const { minimatch } = require('minimatch')
const picomatch = require('picomatch')
const { makeRand } = require('../lib/rand')

const PATTERN_SEG = ['a', 'b', 'ab', '*', '**', '?', 'a*', '*b', '[ab]', '[!a]', '[^a]', '{a,b}']
const PATH_SEG = ['a', 'b', 'ab', 'c', '.a', 'a.b']

function run ({ seed = 3, cases = 20000 } = {}) {
  const { rnd, int, pick } = makeRand(seed)

  const makePattern = () => {
    const n = 1 + int(3)
    const parts = []
    for (let i = 0; i < n; i++) {
      parts.push(pick(PATTERN_SEG))
    }
    return parts.join('/')
  }
  const makePath = () => {
    const n = 1 + int(3)
    const parts = []
    for (let i = 0; i < n; i++) {
      parts.push(pick(PATH_SEG))
    }
    return parts.join('/')
  }

  const seen = new Set()
  const findings = []
  let checked = 0

  for (const options of [{}, { dot: true }]) {
    for (let i = 0; i < cases; i++) {
      const pattern = makePattern()
      const path = makePath()
      // `rnd` is consumed above; this keeps the loop honest about its own budget
      void rnd
      checked++

      let mm, pm
      try { mm = minimatch(path, pattern, options) } catch { continue }
      try { pm = picomatch(pattern, options)(path) } catch { continue }
      if (mm === pm) {
        continue
      }

      const key = `${pattern}|${path}|${options.dot ? 'dot' : ''}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)

      findings.push({
        pattern,
        path,
        minimatch: mm,
        picomatch: pm,
        dot: !!options.dot,
        bracketNegation: /\[!/.test(pattern),
      })
      if (findings.length >= 400) {
        break
      }
    }
  }

  const bracket = findings.filter(f => f.bracketNegation)
  return {
    name: 'minimatch vs picomatch (differential)',
    target: `minimatch@${require('minimatch/package.json').version} vs picomatch@${require('picomatch/package.json').version}`,
    checked,
    findings,
    bracketNegationShare: `${bracket.length}/${findings.length}`,
    upstream: 'https://github.com/micromatch/picomatch/issues/187 (open)',
    novel: false,
  }
}

// The minimized core of every bracket disagreement above.
function minimalCase () {
  return {
    'picomatch("[!a]")("a")': picomatch('[!a]')('a'),
    'picomatch("[!a]")("b")': picomatch('[!a]')('b'),
    'picomatch("[!a]", {posix:true})("a")': picomatch('[!a]', { posix: true })('a'),
    'minimatch("a", "[!a]")': minimatch('a', '[!a]'),
    'minimatch("b", "[!a]")': minimatch('b', '[!a]'),
    'picomatch.makeRe("[!a]")': String(picomatch.makeRe('[!a]')),
    'picomatch.makeRe("[^a]")': String(picomatch.makeRe('[^a]')),
  }
}

module.exports = { run, minimalCase }

if (require.main === module) {
  const r = run()
  console.log(`${r.name} -- ${r.target}`)
  console.log(`checked ${r.checked} pattern/path pairs; disagreements: ${r.findings.length}`)
  console.log(`involving [! bracket negation: ${r.bracketNegationShare}\n`)
  console.log('minimized:')
  for (const [k, v] of Object.entries(minimalCase())) {
    console.log(`  ${k.padEnd(40)} ${v}`)
  }
}
