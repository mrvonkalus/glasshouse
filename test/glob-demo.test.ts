'use strict'

export {}

const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const fs: typeof import('node:fs') = require('node:fs')
const path: typeof import('node:path') = require('node:path')
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
const {
  DEFAULT_SVG_OUTPUT_PATH,
  DEMO_ALT_TEXT,
  escapeXml,
  parseAnsiLine,
  renderDemoSvg,
} = require('../demo/render-demo-svg') as {
  DEFAULT_SVG_OUTPUT_PATH: string
  DEMO_ALT_TEXT: string
  escapeXml: (value: string) => string
  parseAnsiLine: (line: string) => Array<{
    text: string
    bold: boolean
    dim: boolean
    color: 'cyan' | 'green' | 'magenta' | 'red' | 'yellow' | null
  }>
  renderDemoSvg: (report: DemoReport) => string
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

test('ANSI parser preserves nested styles, escapes XML, and rejects unsupported codes', () => {
  assert.deepEqual(
    parseAnsiLine('\u001b[1m\u001b[36m1  GENERATE\u001b[0m\u001b[0m'),
    [
      {
        text: '1  GENERATE',
        bold: true,
        dim: false,
        color: 'cyan',
      },
    ]
  )
  assert.equal(escapeXml('<tag attr="a&b">\'x\'</tag>'), '&lt;tag attr=&quot;a&amp;b&quot;&gt;&apos;x&apos;&lt;/tag&gt;')
  assert.throws(
    () => parseAnsiLine('\u001b[34munsupported blue\u001b[0m'),
    /unsupported SGR code/
  )
  assert.throws(
    () => parseAnsiLine('\u001b[1munclosed bold'),
    /unclosed ANSI SGR state/
  )
})

test('tracked demo SVG asset matches live harness output and README alt text', () => {
  const report = buildReport()
  const expectedSvg = renderDemoSvg(report)
  const trackedSvg = fs.readFileSync(DEFAULT_SVG_OUTPUT_PATH, 'utf8')

  assert.equal(trackedSvg, expectedSvg)
  assert.doesNotMatch(trackedSvg, /\u001b\[/)
  assert.match(trackedSvg, /<title id="glasshouse-demo-title">/)
  assert.match(trackedSvg, /<desc id="glasshouse-demo-desc">/)
  assert.ok(trackedSvg.includes(escapeXml(DEMO_ALT_TEXT)))

  const repoRoot = path.dirname(path.dirname(DEFAULT_SVG_OUTPUT_PATH))
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
  assert.ok(
    readme.includes(`![${DEMO_ALT_TEXT}](./assets/glob-route-drift-demo.svg)`)
  )
})
