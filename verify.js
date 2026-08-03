'use strict'

// Runs every harness and prints the scoreboard.
//   npm install && npm run verify

const HARNESSES = [
  require('./harnesses/semver-subset'),
  require('./harnesses/glob-brackets'),
  require('./harnesses/semver-invariants'),
  require('./harnesses/jsdiff-roundtrip'),
]

const line = (c = '-') => console.log(c.repeat(72))

let realDefects = 0

for (const h of HARNESSES) {
  const r = h.run()
  line()
  console.log(r.name)
  console.log(`  target       ${r.target}`)
  console.log(`  checked      ${r.checked.toLocaleString()} generated cases`)
  console.log(`  findings     ${r.findings.length}`)
  if (r.known && r.known.length) {
    console.log(`  known/closed ${r.known.length}`)
  }
  if (r.bracketNegationShare) {
    console.log(`  of which [! bracket negation: ${r.bracketNegationShare}`)
  }
  if (r.findings.length) {
    realDefects++
    console.log(`  upstream     ${r.upstream}`)
    console.log(`  novel        ${r.novel ? 'yes' : 'NO -- already reported, see above'}`)
    console.log('\n  first three:')
    for (const f of r.findings.slice(0, 3)) {
      if (f.detail) {
        console.log(`    ${f.detail}`)
      } else {
        console.log(`    pattern=${JSON.stringify(f.pattern)} path=${JSON.stringify(f.path)} ` +
                    `minimatch=${f.minimatch} picomatch=${f.picomatch}`)
      }
    }
  } else {
    console.log('  clean.')
  }
  console.log()
}

line('=')
console.log('Harnesses that surfaced a real defect: ' + realDefects + ' of ' + HARNESSES.length)
console.log('Defects that were novel:               0')
console.log()
console.log('Every real defect surfaced here was already reported by someone else')
console.log('before this repo existed. See README.md and FINDINGS-LOG.md.')
console.log()
console.log('Note on the glob differential: only the [! bracket-negation subset is')
console.log('tied to picomatch #187. The remaining disagreements are mostly globstar')
console.log('and trailing-path semantics, which these two libraries are documented to')
console.log('treat differently. They are NOT claimed as defects here.')
line('=')
