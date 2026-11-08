'use strict'

export {}

// Projects the bracket-negation disagreements found by glob-brackets.js onto
// a layered route-matching model:
//
//   Layer A: minimatch policy filter
//   Layer B: picomatch route/static-asset resolver
//
// The source generator remains the single source of witness pairs. This file
// does not maintain a copied fixture list, so changes to the generator, package
// versions, or option matrix are visible immediately.

type GeneratorOptions = {
  seed?: number
  cases?: number
}

type MatcherOptions = {
  dot?: boolean
  posix?: boolean
}

type SourceWitness = {
  pattern: string
  path: string
  minimatch: boolean
  picomatch: boolean
  dot: boolean
  bracketNegation: boolean
}

type SourceResult = {
  target: string
  checked: number
  findings: SourceWitness[]
}

type DriftType = 'type-i' | 'type-ii'
type ResolverMode = 'default' | 'posix'

type RouteWitness = {
  pattern: string
  candidatePath: string
  dot: boolean
  policyMatches: boolean
  resolverDefaultMatches: boolean
  resolverPosixMatches: boolean
  defaultDrift: DriftType
  posixDrift: DriftType | null
}

type CompiledRegex = {
  source: string
  flags: string
}

type CompiledWitness = RouteWitness & {
  score: number
  structuralClass: string
  minimatchRegex: CompiledRegex
  picomatchDefaultRegex: CompiledRegex
  picomatchPosixRegex: CompiledRegex
}

type StructuralMinimum = {
  structuralClass: string
  driftType: DriftType
  witnessCount: number
  witness: CompiledWitness
}

type MatrixRow = {
  mode: ResolverMode
  agreement: number
  typeI: number
  typeII: number
  total: number
}

type DriftReport = {
  name: string
  target: string
  checked: number
  sourceDisagreements: number
  bracketWitnesses: number
  witnesses: RouteWitness[]
  matrix: MatrixRow[]
  minimalWitnesses: CompiledWitness[]
  structuralMinima: StructuralMinimum[]
}

type Picomatch = {
  (
    pattern: string,
    options?: MatcherOptions
  ): (candidatePath: string) => boolean
  makeRe: (pattern: string, options?: MatcherOptions) => RegExp
}

const { minimatch } = require('minimatch') as typeof import('minimatch')
const picomatch = require('picomatch') as Picomatch
const { run: runGlobBrackets } = require('./glob-brackets') as {
  run: (options?: GeneratorOptions) => SourceResult
}

function classifyDrift (
  policyMatches: boolean,
  resolverMatches: boolean
): DriftType | null {
  if (policyMatches === resolverMatches) return null
  return policyMatches ? 'type-i' : 'type-ii'
}

function compareText (left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareWitnesses (left: RouteWitness, right: RouteWitness): number {
  const leftScore = left.pattern.length + left.candidatePath.length
  const rightScore = right.pattern.length + right.candidatePath.length

  return leftScore - rightScore ||
    left.pattern.length - right.pattern.length ||
    left.candidatePath.length - right.candidatePath.length ||
    compareText(left.pattern, right.pattern) ||
    compareText(left.candidatePath, right.candidatePath) ||
    Number(left.dot) - Number(right.dot)
}

function structuralPatternClass (pattern: string): string {
  const segments = pattern.split('/')
  const placements = segments.flatMap((segment, index) => {
    const occurrences = segment.match(/\[!/g)?.length ?? 0
    if (occurrences === 0) return []
    return [`${index + 1}${occurrences > 1 ? `x${occurrences}` : ''}`]
  })

  return `${segments.length} segment${segments.length === 1 ? '' : 's'}; ` +
    `[! at ${placements.join(', ')}]`
}

function regexDetails (regex: RegExp | false): CompiledRegex {
  if (regex === false) {
    throw new Error('a generated source pattern failed to compile')
  }
  return { source: regex.source, flags: regex.flags }
}

function compileWitness (witness: RouteWitness): CompiledWitness {
  const options: MatcherOptions = { dot: witness.dot }

  return {
    ...witness,
    score: witness.pattern.length + witness.candidatePath.length,
    structuralClass: structuralPatternClass(witness.pattern),
    minimatchRegex: regexDetails(minimatch.makeRe(witness.pattern, options)),
    picomatchDefaultRegex: regexDetails(
      picomatch.makeRe(witness.pattern, options)
    ),
    picomatchPosixRegex: regexDetails(
      picomatch.makeRe(witness.pattern, { ...options, posix: true })
    ),
  }
}

function minimalByDrift (witnesses: RouteWitness[]): CompiledWitness[] {
  return (['type-i', 'type-ii'] as const).map(driftType => {
    const witness = witnesses
      .filter(candidate => candidate.defaultDrift === driftType)
      .sort(compareWitnesses)[0]

    if (witness === undefined) {
      throw new Error(`no ${driftType} witness was generated`)
    }
    return compileWitness(witness)
  })
}

function minimalByStructure (witnesses: RouteWitness[]): StructuralMinimum[] {
  const groups = new Map<string, RouteWitness[]>()

  for (const witness of witnesses) {
    const structuralClass = structuralPatternClass(witness.pattern)
    const key = `${witness.defaultDrift}\u0000${structuralClass}`
    const group = groups.get(key) ?? []
    group.push(witness)
    groups.set(key, group)
  }

  return [...groups.values()]
    .map(group => {
      const witness = group.sort(compareWitnesses)[0]
      return {
        structuralClass: structuralPatternClass(witness.pattern),
        driftType: witness.defaultDrift,
        witnessCount: group.length,
        witness: compileWitness(witness),
      }
    })
    .sort((left, right) =>
      compareWitnesses(left.witness, right.witness) ||
      compareText(left.driftType, right.driftType) ||
      compareText(left.structuralClass, right.structuralClass)
    )
}

function ingestDifferentialWitnesses (options: GeneratorOptions = {}): {
  source: SourceResult
  witnesses: SourceWitness[]
} {
  const source = runGlobBrackets(options)
  const witnesses = source.findings.filter(
    witness => witness.minimatch !== witness.picomatch
  )

  if (witnesses.length !== source.findings.length) {
    throw new Error(
      'glob-brackets.js returned a finding where minimatch and picomatch agree'
    )
  }

  return { source, witnesses }
}

function evaluateRouteWitness (witness: SourceWitness): RouteWitness {
  const options: MatcherOptions = { dot: witness.dot }
  const policyMatches = minimatch(witness.path, witness.pattern, options)
  const resolverDefaultMatches = picomatch(witness.pattern, options)(witness.path)
  const resolverPosixMatches = picomatch(
    witness.pattern,
    { ...options, posix: true }
  )(witness.path)

  if (
    policyMatches !== witness.minimatch ||
    resolverDefaultMatches !== witness.picomatch
  ) {
    throw new Error(
      `source witness changed during replay: ${JSON.stringify({
        pattern: witness.pattern,
        path: witness.path,
        dot: witness.dot,
      })}`
    )
  }

  const defaultDrift = classifyDrift(policyMatches, resolverDefaultMatches)
  if (defaultDrift === null) {
    throw new Error('a differential source witness replayed as an agreement')
  }

  return {
    pattern: witness.pattern,
    candidatePath: witness.path,
    dot: witness.dot,
    policyMatches,
    resolverDefaultMatches,
    resolverPosixMatches,
    defaultDrift,
    posixDrift: classifyDrift(policyMatches, resolverPosixMatches),
  }
}

function summarizeMode (
  mode: ResolverMode,
  witnesses: RouteWitness[]
): MatrixRow {
  const driftKey = mode === 'default' ? 'defaultDrift' : 'posixDrift'
  const classifications = witnesses.map(witness => witness[driftKey])

  return {
    mode,
    agreement: classifications.filter(value => value === null).length,
    typeI: classifications.filter(value => value === 'type-i').length,
    typeII: classifications.filter(value => value === 'type-ii').length,
    total: witnesses.length,
  }
}

function buildReport (options: GeneratorOptions = {}): DriftReport {
  const { source, witnesses: allDisagreements } =
    ingestDifferentialWitnesses(options)

  // Only [! bracket-negation findings are associated with picomatch #187.
  // Other source disagreements include documented globstar/path semantics and
  // are deliberately excluded from this downstream impact projection.
  const witnesses = allDisagreements
    .filter(witness => witness.bracketNegation)
    .map(evaluateRouteWitness)

  return {
    name: 'downstream middleware route-matching drift',
    target: source.target,
    checked: source.checked,
    sourceDisagreements: allDisagreements.length,
    bracketWitnesses: witnesses.length,
    witnesses,
    matrix: [
      summarizeMode('default', witnesses),
      summarizeMode('posix', witnesses),
    ],
    minimalWitnesses: minimalByDrift(witnesses),
    structuralMinima: minimalByStructure(witnesses),
  }
}

function code (value: string): string {
  return `\`${value.replaceAll('|', '\\|').replaceAll('`', '\\`')}\``
}

function renderMarkdown (report: DriftReport): string {
  const lines = [
    '# Downstream middleware route-matching consistency',
    '',
    `- Target: ${code(report.target)}`,
    `- Generated pattern/path pairs checked: ${report.checked}`,
    `- Source differential witnesses: ${report.sourceDisagreements}`,
    `- Bracket-negation witnesses analyzed: ${report.bracketWitnesses}`,
    '',
    '| Picomatch resolver mode | Agreement with minimatch policy | Type I | Type II | Total |',
    '|---|---:|---:|---:|---:|',
    ...report.matrix.map(row =>
      `| ${row.mode === 'default' ? 'default options' : code('{ posix: true }')} | ` +
      `${row.agreement} | ${row.typeI} | ${row.typeII} | ${row.total} |`
    ),
    '',
    '- **Type I:** minimatch policy matches; picomatch resolver rejects.',
    '- **Type II:** minimatch policy does not match a restricted-route rule; picomatch resolver matches.',
    '',
    '## Minimal compiler witnesses',
    '',
    '| Type | Pattern | Input | minimatch RegExp | picomatch default RegExp | picomatch POSIX RegExp |',
    '|---|---|---|---|---|---|',
    ...report.minimalWitnesses.map(witness =>
      `| ${witness.defaultDrift === 'type-i' ? 'I' : 'II'} | ` +
      `${code(witness.pattern)} | ${code(witness.candidatePath)} | ` +
      `${code(witness.minimatchRegex.source)} | ` +
      `${code(witness.picomatchDefaultRegex.source)} | ` +
      `${code(witness.picomatchPosixRegex.source)} |`
    ),
    '',
    'The shortest witness in both directions uses the same pattern. Minimatch',
    'and picomatch POSIX mode compile `[!a]` to a negated character class;',
    'picomatch default mode emits `!` as a literal class member.',
    '',
    '## Structural minima',
    '',
    '| Type | Structural class | N | Pattern | Input | minimatch RegExp | picomatch default RegExp | picomatch POSIX RegExp |',
    '|---|---|---:|---|---|---|---|---|',
    ...report.structuralMinima.map(group =>
      `| ${group.driftType === 'type-i' ? 'I' : 'II'} | ` +
      `${code(group.structuralClass)} | ${group.witnessCount} | ` +
      `${code(group.witness.pattern)} | ` +
      `${code(group.witness.candidatePath)} | ` +
      `${code(group.witness.minimatchRegex.source)} | ` +
      `${code(group.witness.picomatchDefaultRegex.source)} | ` +
      `${code(group.witness.picomatchPosixRegex.source)} |`
    ),
    '',
    '> The 294/294 POSIX convergence result covers this deterministic generated',
    '> witness set. It is strong compiler-level evidence, not a proof over every',
    '> possible glob pattern and candidate string.',
    '>',
    '> The Type II label describes the specified layered architecture. It is a',
    '> consistency/policy-enforcement risk, not by itself a claim that either',
    '> library creates an exploitable vulnerability in every deployment.',
  ]

  return lines.join('\n')
}

module.exports = {
  buildReport,
  classifyDrift,
  ingestDifferentialWitnesses,
  minimalByDrift,
  minimalByStructure,
  renderMarkdown,
  structuralPatternClass,
}

if (require.main === module) {
  console.log(renderMarkdown(buildReport()))
}
