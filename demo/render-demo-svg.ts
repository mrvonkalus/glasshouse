'use strict'

export {}

const fs: typeof import('node:fs') = require('node:fs')
const path: typeof import('node:path') = require('node:path')

type AnsiColor = 'cyan' | 'green' | 'magenta' | 'red' | 'yellow'

type SpanStyle = {
  bold: boolean
  dim: boolean
  color: AnsiColor | null
}

type StyledSpan = SpanStyle & {
  text: string
}

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
const { renderDemo } = require('./glob-route-drift') as {
  renderDemo: (report: DemoReport, options?: { color?: boolean }) => string
}

const README_ALT_TEXT =
  'Glasshouse terminal demonstration comparing minimatch@10.2.6 and ' +
  'picomatch@4.0.5 across 40,000 seeded glob cases (seed 3): 294 ' +
  'bracket-negation disagreements reduce to minimized witnesses b and a ' +
  'against rule [!a], expose contrasting compiled regular expressions, ' +
  'and reach 294/294 agreement under { posix: true } across the generated ' +
  'witness set.'

const SVG_DESC_TEXT =
  'Terminal output of Glasshouse\'s 30-line route-policy drift demonstration ' +
  '(minimatch@10.2.6 vs picomatch@4.0.5, seed 3). Step 1 replays 40,000 ' +
  'pattern/path pairs and isolates 294 bracket-negation disagreements. ' +
  'Step 2 shows minimized witnesses for shared rule [!a]: Type I input b ' +
  'matches minimatch policy and fails default picomatch; Type II input a ' +
  'fails minimatch policy and matches default picomatch. Step 3 shows ' +
  'compiled regular expressions: minimatch emits ^(?!\\.)[^a]$, picomatch ' +
  'default emits ^(?:(?:\\[!a\\]|[!a])\\/?)$, and picomatch POSIX emits ' +
  '^(?:[^a/]\\/?)$. Step 4 verifies convergence: default options produce ' +
  '190 Type I + 104 Type II = 294 drift, while { posix: true } produces ' +
  '294/294 agreement and 0 drift across the generated witness set, with a ' +
  'scope note stating this is not a universal proof or vulnerability claim.'

const PALETTE = {
  background: '#0d1117',
  border: '#30363d',
  headerBackground: '#161b22',
  foreground: '#e6edf3',
  dim: '#8b949e',
  cyan: '#56d4dd',
  green: '#3fb950',
  magenta: '#d2a8ff',
  red: '#ff7b72',
  yellow: '#e3b341',
} as const

const FONT_FAMILY =
  "'SFMono-Regular', 'DejaVu Sans Mono', Consolas, 'Liberation Mono', Menlo, monospace"
const SVG_WIDTH = 740
const HEADER_HEIGHT = 40
const PADDING_X = 28
const FIRST_LINE_Y = 68
const LINE_HEIGHT = 21
const BOTTOM_PADDING = 27

const SGR_COLOR_BY_CODE: Record<number, AnsiColor> = {
  31: 'red',
  32: 'green',
  33: 'yellow',
  35: 'magenta',
  36: 'cyan',
}

function escapeXml (value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function stylesEqual (left: SpanStyle, right: SpanStyle): boolean {
  return (
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.color === right.color
  )
}

function assertCleanPlainText (segment: string): void {
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(segment)) {
    throw new Error(
      `unsupported control sequence in demo output: ${JSON.stringify(segment)}`
    )
  }
}

function parseAnsiLine (line: string): StyledSpan[] {
  const spans: StyledSpan[] = []
  let state: SpanStyle = { bold: false, dim: false, color: null }
  const sgrPattern = /\u001b\[([0-9;]*)m/g
  let cursor = 0

  const pushText = (text: string): void => {
    if (text.length === 0) return
    assertCleanPlainText(text)
    const previous = spans[spans.length - 1]
    if (previous !== undefined && stylesEqual(previous, state)) {
      previous.text += text
      return
    }
    spans.push({
      text,
      bold: state.bold,
      dim: state.dim,
      color: state.color,
    })
  }

  for (const match of line.matchAll(sgrPattern)) {
    const matchIndex = match.index ?? 0
    if (matchIndex > cursor) {
      pushText(line.slice(cursor, matchIndex))
    }

    const rawParams = match[1]
    const codes =
      rawParams === ''
        ? [0]
        : rawParams.split(';').map(token => Number.parseInt(token, 10))

    for (const code of codes) {
      if (code === 0) {
        state = { bold: false, dim: false, color: null }
      } else if (code === 1) {
        state = { ...state, bold: true }
      } else if (code === 2) {
        state = { ...state, dim: true }
      } else if (code in SGR_COLOR_BY_CODE) {
        state = { ...state, color: SGR_COLOR_BY_CODE[code] }
      } else {
        throw new Error(`unsupported SGR code in demo output: ${String(code)}`)
      }
    }

    cursor = matchIndex + match[0].length
  }

  if (cursor < line.length) {
    pushText(line.slice(cursor))
  }

  if (state.bold || state.dim || state.color !== null) {
    throw new Error(`unclosed ANSI SGR state at end of line: ${JSON.stringify(line)}`)
  }

  return spans
}

function resolveFill (span: SpanStyle): string {
  if (span.color !== null) {
    return PALETTE[span.color]
  }
  if (span.dim) {
    return PALETTE.dim
  }
  return PALETTE.foreground
}

function renderSvgLine (spans: StyledSpan[], y: number): string | null {
  if (spans.length === 0) return null

  const tspans = spans
    .map(span => {
      const attrs: string[] = []
      const fill = resolveFill(span)
      if (fill !== PALETTE.foreground) {
        attrs.push(`fill="${fill}"`)
      }
      if (span.bold) {
        attrs.push('font-weight="700"')
      }
      const attrSuffix = attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
      return `<tspan${attrSuffix}>${escapeXml(span.text)}</tspan>`
    })
    .join('')

  return `    <text x="${PADDING_X}" y="${y}">${tspans}</text>`
}

function renderDemoSvg (report: DemoReport): string {
  const coloredLines = renderDemo(report, { color: true }).split('\n')
  const plainLines = renderDemo(report, { color: false }).split('\n')

  if (coloredLines.length !== plainLines.length) {
    throw new Error('colored and plain demo outputs have different line counts')
  }

  const parsedLines = coloredLines.map((line, index) => {
    const spans = parseAnsiLine(line)
    const reconstructed = spans.map(span => span.text).join('')
    if (reconstructed !== plainLines[index]) {
      throw new Error(
        `SVG span text diverged from plain demo output on line ${index + 1}`
      )
    }
    return spans
  })

  const svgHeight =
    FIRST_LINE_Y + (parsedLines.length - 1) * LINE_HEIGHT + BOTTOM_PADDING

  const textElements = parsedLines
    .map((spans, index) => renderSvgLine(spans, FIRST_LINE_Y + index * LINE_HEIGHT))
    .filter((element): element is string => element !== null)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${svgHeight}" viewBox="0 0 ${SVG_WIDTH} ${svgHeight}" role="img" aria-labelledby="glasshouse-demo-title glasshouse-demo-desc">`,
    '  <title id="glasshouse-demo-title">Glasshouse route-policy drift terminal demonstration</title>',
    `  <desc id="glasshouse-demo-desc">${escapeXml(SVG_DESC_TEXT)}</desc>`,
    `  <rect x="0.5" y="0.5" width="${SVG_WIDTH - 1}" height="${svgHeight - 1}" rx="12" fill="${PALETTE.background}" stroke="${PALETTE.border}"/>`,
    `  <path d="M12.5 0.5 H${SVG_WIDTH - 12.5} A12 12 0 0 1 ${SVG_WIDTH - 0.5} 12.5 V${HEADER_HEIGHT} H0.5 V12.5 A12 12 0 0 1 12.5 0.5 Z" fill="${PALETTE.headerBackground}"/>`,
    `  <line x1="0.5" y1="${HEADER_HEIGHT}" x2="${SVG_WIDTH - 0.5}" y2="${HEADER_HEIGHT}" stroke="${PALETTE.border}"/>`,
    '  <g aria-hidden="true">',
    '    <circle cx="22" cy="20" r="6" fill="#ff5f56"/>',
    '    <circle cx="42" cy="20" r="6" fill="#ffbd2e"/>',
    '    <circle cx="62" cy="20" r="6" fill="#27c93f"/>',
    `    <text x="${SVG_WIDTH / 2}" y="25" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="12" fill="${PALETTE.dim}">npm run demo</text>`,
    '  </g>',
    `  <g font-family="${FONT_FAMILY}" font-size="14" fill="${PALETTE.foreground}" xml:space="preserve" style="white-space: pre">`,
    ...textElements,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}

const REPO_ROOT =
  path.basename(path.dirname(__dirname)) === '.build'
    ? path.resolve(__dirname, '../..')
    : path.resolve(__dirname, '..')

const DEFAULT_SVG_OUTPUT_PATH = path.join(
  REPO_ROOT,
  'assets/glob-route-drift-demo.svg'
)

module.exports = {
  DEFAULT_SVG_OUTPUT_PATH,
  README_ALT_TEXT,
  SVG_DESC_TEXT,
  escapeXml,
  parseAnsiLine,
  renderDemoSvg,
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2))
  const svg = renderDemoSvg(buildReport())
  if (args.has('--stdout')) {
    process.stdout.write(svg)
  } else {
    fs.mkdirSync(path.dirname(DEFAULT_SVG_OUTPUT_PATH), { recursive: true })
    fs.writeFileSync(DEFAULT_SVG_OUTPUT_PATH, svg, 'utf8')
  }
}
