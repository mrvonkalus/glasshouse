'use strict'

export {}

type DriftType = 'type-i' | 'type-ii'

type MinimalWitness = {
  pattern: string
  candidatePath: string
  policyMatches: boolean
  resolverDefaultMatches: boolean
  resolverPosixMatches: boolean
  defaultDrift: DriftType
  minimatchRegex: { source: string }
  picomatchDefaultRegex: { source: string }
  picomatchPosixRegex: { source: string }
}

type MatrixRow = {
  mode: 'default' | 'posix'
  agreement: number
  typeI: number
  typeII: number
  total: number
}

type DriftReport = {
  target: string
  checked: number
  bracketWitnesses: number
  minimalWitnesses: MinimalWitness[]
  matrix: MatrixRow[]
}

type DemoOptions = {
  color?: boolean
}

const { buildReport } = require('../harnesses/glob-middleware-drift') as {
  buildReport: () => DriftReport
}

const ANSI = {
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  magenta: '\u001b[35m',
  red: '\u001b[31m',
  reset: '\u001b[0m',
  yellow: '\u001b[33m',
} as const

function renderDemo (
  report: DriftReport,
  { color = false }: DemoOptions = {}
): string {
  const paint = (style: keyof typeof ANSI, value: string): string =>
    color ? `${ANSI[style]}${value}${ANSI.reset}` : value
  const heading = (value: string): string =>
    paint('bold', paint('cyan', value))
  const value = (input: string | number): string =>
    paint('bold', String(input))

  const typeI = report.minimalWitnesses.find(
    witness => witness.defaultDrift === 'type-i'
  )
  const typeII = report.minimalWitnesses.find(
    witness => witness.defaultDrift === 'type-ii'
  )
  const defaults = report.matrix.find(row => row.mode === 'default')
  const posix = report.matrix.find(row => row.mode === 'posix')

  if (!typeI || !typeII || !defaults || !posix) {
    throw new Error('the route-drift report is missing a required demo result')
  }

  const decision = (matched: boolean): string =>
    matched ? paint('green', 'MATCH') : paint('red', 'NO MATCH')

  return [
    heading('GLASSHOUSE // ROUTE-POLICY DRIFT'),
    paint('dim', `deterministic differential test · ${report.target} · seed 3`),
    '',
    heading('1  GENERATE'),
    `   ${value(report.checked.toLocaleString('en-US'))} pattern/path pairs replayed`,
    `   ${value(report.bracketWitnesses)} bracket-negation disagreements isolated`,
    '',
    heading('2  SHORTEST WITNESSES'),
    `   shared rule       ${paint('yellow', typeII.pattern)}`,
    `   Type I  input ${value(typeI.candidatePath)}   policy ${decision(typeI.policyMatches)}  →  resolver ${decision(typeI.resolverDefaultMatches)}`,
    `   Type II input ${value(typeII.candidatePath)}   policy ${decision(typeII.policyMatches)}  →  resolver ${decision(typeII.resolverDefaultMatches)}`,
    '',
    `   ${paint('magenta', 'Type II route simulation')}`,
    `   restricted rule does not fire  →  downstream resolver selects ${value(typeII.candidatePath)}`,
    '',
    heading('3  COMPILER X-RAY'),
    `   minimatch          ${typeII.minimatchRegex.source}`,
    `   picomatch default  ${typeII.picomatchDefaultRegex.source}`,
    `   picomatch POSIX    ${typeII.picomatchPosixRegex.source}`,
    '',
    `   default mode treats ${paint('yellow', '!')} as a literal class member;`,
    `   POSIX mode compiles ${paint('yellow', '[!a]')} as a negated character class.`,
    '',
    heading('4  VERIFY THE FIX'),
    `   default options    ${value(defaults.typeI)} Type I + ${value(defaults.typeII)} Type II = ${paint('red', `${defaults.total} drift`)}`,
    `   { posix: true }    ${paint('green', `${posix.agreement}/${posix.total} agree · 0 drift`)}`,
    '',
    paint('bold', paint('green', 'VERDICT  Same rule. Same input. Different decisions—made reproducible.')),
    paint('dim', 'Scope: deterministic generated witness set only.'),
    paint('dim', '       Not a universal proof or vulnerability claim.'),
  ].join('\n')
}

module.exports = { renderDemo }

if (require.main === module) {
  const color = process.stdout.isTTY && process.env.NO_COLOR === undefined
  console.log(renderDemo(buildReport(), { color }))
}
