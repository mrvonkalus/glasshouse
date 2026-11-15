'use strict'

export {}

const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const test: typeof import('node:test') = require('node:test')

type DemoReport = {
  target: string
  checked: number
  bracketWitnesses: number
  minimalWitnesses: Array<{
    pattern: string
    candidatePath: string
    policyMatches: boolean
    resolverDefaultMatches: boolean
    resolverPosixMatches: boolean
    defaultDrift: 'type-i' | 'type-ii'
    minimatchRegex: { source: string }
    picomatchDefaultRegex: { source: string }
    picomatchPosixRegex: { source: string }
  }>
  matrix: Array<{
    mode: 'default' | 'posix'
    agreement: number
    typeI: number
    typeII: number
    total: number
  }>
}

const { buildReport } = require('../harnesses/glob-middleware-drift') as {
  buildReport: () => DemoReport
}
const { renderDemo } = require('../demo/glob-route-drift') as {
  renderDemo: (report: DemoReport, options?: { color?: boolean }) => string
}

test('demo tells the complete generated-witness story without ANSI', () => {
  const output = renderDemo(buildReport(), { color: false })

  assert.match(output, /40,000 pattern\/path pairs replayed/)
  assert.match(output, /294 bracket-negation disagreements isolated/)
  assert.match(output, /Type I  input b\s+policy MATCH\s+→\s+resolver NO MATCH/)
  assert.match(output, /Type II input a\s+policy NO MATCH\s+→\s+resolver MATCH/)
  assert.match(output, /190 Type I \+ 104 Type II = 294 drift/)
  assert.match(output, /294\/294 agree · 0 drift/)
  assert.match(output, /Not a universal proof or vulnerability claim/)
  assert.doesNotMatch(output, /\u001b\[/)
})

test('demo includes exact compiler output and optional terminal color', () => {
  const output = renderDemo(buildReport(), { color: true })

  assert.match(output, /\^\(\?!\\\.\)\[\^a\]\$/)
  assert.match(output, /\(\?:\\\[!a\\\]\|\[!a\]\)/)
  assert.match(output, /\^\(\?:\[\^a\/\]\\\/\?\)\$/)
  assert.match(output, /\u001b\[/)
})
