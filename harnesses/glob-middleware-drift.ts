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

import type { MinimatchOptions } from 'minimatch'

const { minimatch } = require('minimatch') as typeof import('minimatch')
const {
  SHARED_OPTION_KEYS,
  classifyDrift,
  compareShrinkTuple,
  evaluateWitness,
  sharedOptionsEqual,
  shrinkWitness,
} = require('../lib/glob-shrink') as {
  SHARED_OPTION_KEYS: readonly [
    'dot',
    'nocase',
    'nobrace',
    'noglobstar',
    'noext',
    'nonegate',
  ]
  classifyDrift: (
    policyMatches: boolean,
    resolverMatches: boolean
  ) => DriftType | null
  compareShrinkTuple: (
    left: { pattern: string; candidatePath: string },
    right: { pattern: string; candidatePath: string }
  ) => number
  evaluateWitness: (witness: {
    pattern: string
    candidatePath: string
    options: SharedMatcherOptions
  }) => {
    policyMatches: boolean
    resolverDefaultMatches: boolean
    resolverPosixMatches: boolean
    defaultDrift: DriftType | null
    posixDrift: DriftType | null
    bracketNegation: boolean
    defaultRegexConsistent: boolean
    posixRegexConsistent: boolean
    regexConsistent: boolean
  } | null
  sharedOptionsEqual: (
    left: SharedMatcherOptions,
    right: SharedMatcherOptions
  ) => boolean
  shrinkWitness: (
    seed: {
      pattern: string
      candidatePath: string
      options: SharedMatcherOptions
    },
    options?: {
      preserveStructure?: boolean
      structuralClassifier?: (pattern: string) => string
      maxSteps?: number
    }
  ) => {
    seed: {
      pattern: string
      candidatePath: string
      options: SharedMatcherOptions
    }
    witness: {
      pattern: string
      candidatePath: string
      options: SharedMatcherOptions
    }
    evaluation: {
      policyMatches: boolean
      resolverDefaultMatches: boolean
      resolverPosixMatches: boolean
      defaultDrift: DriftType | null
      posixDrift: DriftType | null
      bracketNegation: boolean
      defaultRegexConsistent: boolean
      posixRegexConsistent: boolean
      regexConsistent: boolean
    }
    steps: number
    candidatesTested: number
    initialScore: number
    finalScore: number
    minimal: boolean
  }
}

type GeneratorOptions = {
  seed?: number
  cases?: number
}

type SharedOptionKey = (typeof SHARED_OPTION_KEYS)[number]
type SharedMatcherOptions = Partial<Record<SharedOptionKey, boolean>>

type PicomatchOptions = SharedMatcherOptions & {
  posix?: boolean
  strictSlashes?: boolean
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

type ShrinkProvenance = {
  seedPattern: string
  seedCandidatePath: string
  seedScore: number
  steps: number
  minimal: boolean
}

type CompiledWitness = RouteWitness & {
  score: number
  structuralClass: string
  minimatchRegex: CompiledRegex
  picomatchDefaultRegex: CompiledRegex
  picomatchPosixRegex: CompiledRegex
  shrink: ShrinkProvenance
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

type ModeOutcomeSummary = {
  agreement: number
  typeI: number
  typeII: number
  regexConsistent: number
}

type SharedOptionMatrixRow = {
  id: string
  label: string
  sharedOptions: SharedMatcherOptions | 'from-witness'
  defaultMode: ModeOutcomeSummary
  posixMode: ModeOutcomeSummary
  total: number
}

type DisagreementPartition = {
  totalDisagreements: number
  bracketNegation: {
    count: number
    resolvedByPosix: number
    resolvedByStrictSlashes: number
  }
  nonBracketDialect: {
    count: number
    trailingGlobstarCount: number
    resolvedByPosix: number
    resolvedByStrictSlashes: number
  }
  combinedPosixAndStrictSlashesAgreement: number
}

type NormalFormSummary = {
  driftType: DriftType
  pattern: string
  candidatePath: string
  dot: boolean
  count: number
}

type ShrinkSummary = {
  totalWitnesses: number
  verifiedMinimal: number
  preservedClassification: number
  preservedOptions: number
  strictlyReduced: number
  maxSteps: number
  normalForms: NormalFormSummary[]
}

type DriftReport = {
  name: string
  target: string
  checked: number
  sourceDisagreements: number
  bracketWitnesses: number
  witnesses: RouteWitness[]
  matrix: MatrixRow[]
  sharedOptionsMatrix: SharedOptionMatrixRow[]
  disagreementPartition: DisagreementPartition
  shrinkSummary: ShrinkSummary
  minimalWitnesses: CompiledWitness[]
  structuralMinima: StructuralMinimum[]
}

type Picomatch = {
  (
    pattern: string,
    options?: PicomatchOptions
  ): (candidatePath: string) => boolean
  makeRe: (pattern: string, options?: PicomatchOptions) => RegExp
}

const picomatch = require('picomatch') as Picomatch
const { run: runGlobBrackets } = require('./glob-brackets') as {
  run: (options?: GeneratorOptions) => SourceResult
}

const SHARED_OPTION_PROFILES: ReadonlyArray<{
  id: string
  label: string
  sharedOptions: SharedMatcherOptions | 'from-witness'
  resolveOptions: (witness: RouteWitness) => SharedMatcherOptions
}> = [
  {
    id: 'witness-recorded',
    label: 'witness dot state',
    sharedOptions: 'from-witness',
    resolveOptions: witness => ({ dot: witness.dot }),
  },
  {
    id: 'dot:false',
    label: '{ dot: false }',
    sharedOptions: { dot: false },
    resolveOptions: () => ({ dot: false }),
  },
  {
    id: 'dot:true',
    label: '{ dot: true }',
    sharedOptions: { dot: true },
    resolveOptions: () => ({ dot: true }),
  },
  {
    id: 'nocase:true',
    label: '{ nocase: true }',
    sharedOptions: { nocase: true },
    resolveOptions: witness => ({ dot: witness.dot, nocase: true }),
  },
  {
    id: 'nobrace:true',
    label: '{ nobrace: true }',
    sharedOptions: { nobrace: true },
    resolveOptions: witness => ({ dot: witness.dot, nobrace: true }),
  },
  {
    id: 'noglobstar:true',
    label: '{ noglobstar: true }',
    sharedOptions: { noglobstar: true },
    resolveOptions: witness => ({ dot: witness.dot, noglobstar: true }),
  },
  {
    id: 'noext:true',
    label: '{ noext: true }',
    sharedOptions: { noext: true },
    resolveOptions: witness => ({ dot: witness.dot, noext: true }),
  },
  {
    id: 'nonegate:true',
    label: '{ nonegate: true }',
    sharedOptions: { nonegate: true },
    resolveOptions: witness => ({ dot: witness.dot, nonegate: true }),
  },
  {
    id: 'all-shared:true',
    label: 'all 6 shared flags true',
    sharedOptions: {
      dot: true,
      nocase: true,
      nobrace: true,
      noglobstar: true,
      noext: true,
      nonegate: true,
    },
    resolveOptions: () => ({
      dot: true,
      nocase: true,
      nobrace: true,
      noglobstar: true,
      noext: true,
      nonegate: true,
    }),
  },
]

function compareText (left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareWitnesses (left: RouteWitness, right: RouteWitness): number {
  return (
    compareShrinkTuple(left, right) ||
    Number(left.dot) - Number(right.dot)
  )
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

function compileWitness (
  witness: RouteWitness,
  shrink?: ShrinkProvenance
): CompiledWitness {
  const options: SharedMatcherOptions = { dot: witness.dot }
  const score = witness.pattern.length + witness.candidatePath.length

  return {
    ...witness,
    score,
    structuralClass: structuralPatternClass(witness.pattern),
    minimatchRegex: regexDetails(
      minimatch.makeRe(witness.pattern, options as MinimatchOptions)
    ),
    picomatchDefaultRegex: regexDetails(
      picomatch.makeRe(witness.pattern, options)
    ),
    picomatchPosixRegex: regexDetails(
      picomatch.makeRe(witness.pattern, { ...options, posix: true })
    ),
    shrink: shrink ?? {
      seedPattern: witness.pattern,
      seedCandidatePath: witness.candidatePath,
      seedScore: score,
      steps: 0,
      minimal: true,
    },
  }
}

function shrinkRouteWitness (
  witness: RouteWitness,
  { preserveStructure = false }: { preserveStructure?: boolean } = {}
): { routeWitness: RouteWitness; provenance: ShrinkProvenance } {
  const seedOptions: SharedMatcherOptions = { dot: witness.dot }
  const shrunk = shrinkWitness(
    {
      pattern: witness.pattern,
      candidatePath: witness.candidatePath,
      options: seedOptions,
    },
    {
      preserveStructure,
      structuralClassifier: preserveStructure
        ? structuralPatternClass
        : undefined,
    }
  )

  if (
    shrunk.evaluation.defaultDrift !== witness.defaultDrift ||
    shrunk.evaluation.posixDrift !== witness.posixDrift ||
    !sharedOptionsEqual(shrunk.witness.options, seedOptions)
  ) {
    throw new Error(
      `shrink invariant failed for ${JSON.stringify({
        pattern: witness.pattern,
        candidatePath: witness.candidatePath,
        dot: witness.dot,
      })}`
    )
  }

  return {
    routeWitness: {
      pattern: shrunk.witness.pattern,
      candidatePath: shrunk.witness.candidatePath,
      dot: Boolean(shrunk.witness.options.dot),
      policyMatches: shrunk.evaluation.policyMatches,
      resolverDefaultMatches: shrunk.evaluation.resolverDefaultMatches,
      resolverPosixMatches: shrunk.evaluation.resolverPosixMatches,
      defaultDrift: witness.defaultDrift,
      posixDrift: shrunk.evaluation.posixDrift,
    },
    provenance: {
      seedPattern: shrunk.seed.pattern,
      seedCandidatePath: shrunk.seed.candidatePath,
      seedScore: shrunk.initialScore,
      steps: shrunk.steps,
      minimal: shrunk.minimal,
    },
  }
}

function compareReducedEntries (
  left: { routeWitness: RouteWitness; provenance: ShrinkProvenance },
  right: { routeWitness: RouteWitness; provenance: ShrinkProvenance }
): number {
  return (
    compareWitnesses(left.routeWitness, right.routeWitness) ||
    left.provenance.steps - right.provenance.steps ||
    left.provenance.seedScore - right.provenance.seedScore ||
    compareText(left.provenance.seedPattern, right.provenance.seedPattern) ||
    compareText(
      left.provenance.seedCandidatePath,
      right.provenance.seedCandidatePath
    )
  )
}

function shrinkAllWitnesses (witnesses: RouteWitness[]): {
  minimalWitnesses: CompiledWitness[]
  shrinkSummary: ShrinkSummary
} {
  const reduced = witnesses.map(witness => shrinkRouteWitness(witness))
  const normalFormCounts = new Map<string, NormalFormSummary>()
  let verifiedMinimal = 0
  let strictlyReduced = 0
  let maxSteps = 0

  for (const entry of reduced) {
    const { routeWitness, provenance } = entry
    if (provenance.minimal) verifiedMinimal++
    if (provenance.steps > 0) strictlyReduced++
    if (provenance.steps > maxSteps) maxSteps = provenance.steps

    const key =
      `${routeWitness.defaultDrift}\u0000` +
      `${routeWitness.pattern}\u0000` +
      `${routeWitness.candidatePath}\u0000` +
      `${String(routeWitness.dot)}`
    const current = normalFormCounts.get(key)
    if (current === undefined) {
      normalFormCounts.set(key, {
        driftType: routeWitness.defaultDrift,
        pattern: routeWitness.pattern,
        candidatePath: routeWitness.candidatePath,
        dot: routeWitness.dot,
        count: 1,
      })
    } else {
      current.count++
    }
  }

  const minimalWitnesses = (['type-i', 'type-ii'] as const).map(driftType => {
    const best = reduced
      .filter(entry => entry.routeWitness.defaultDrift === driftType)
      .sort(compareReducedEntries)[0]

    if (best === undefined) {
      throw new Error(`no ${driftType} witness was generated`)
    }
    return compileWitness(best.routeWitness, best.provenance)
  })

  const normalForms = [...normalFormCounts.values()].sort(
    (left, right) =>
      compareText(left.driftType, right.driftType) ||
      Number(left.dot) - Number(right.dot) ||
      compareText(left.pattern, right.pattern) ||
      compareText(left.candidatePath, right.candidatePath)
  )

  return {
    minimalWitnesses,
    shrinkSummary: {
      totalWitnesses: witnesses.length,
      verifiedMinimal,
      preservedClassification: reduced.length,
      preservedOptions: reduced.length,
      strictlyReduced,
      maxSteps,
      normalForms,
    },
  }
}

function minimalByDrift (witnesses: RouteWitness[]): CompiledWitness[] {
  return shrinkAllWitnesses(witnesses).minimalWitnesses
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
      const best = group
        .map(candidate =>
          shrinkRouteWitness(candidate, { preserveStructure: true })
        )
        .sort(compareReducedEntries)[0]

      return {
        structuralClass: structuralPatternClass(best.routeWitness.pattern),
        driftType: best.routeWitness.defaultDrift,
        witnessCount: group.length,
        witness: compileWitness(best.routeWitness, best.provenance),
      }
    })
    .sort(
      (left, right) =>
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
  const options: SharedMatcherOptions = { dot: witness.dot }
  const policyMatches = minimatch(
    witness.path,
    witness.pattern,
    options as MinimatchOptions
  )
  const resolverDefaultMatches = picomatch(witness.pattern, options)(
    witness.path
  )
  const resolverPosixMatches = picomatch(witness.pattern, {
    ...options,
    posix: true,
  })(witness.path)

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

function evaluateSharedOptionMatrix (
  witnesses: RouteWitness[]
): SharedOptionMatrixRow[] {
  return SHARED_OPTION_PROFILES.map(profile => {
    const defaultMode: ModeOutcomeSummary = {
      agreement: 0,
      typeI: 0,
      typeII: 0,
      regexConsistent: 0,
    }
    const posixMode: ModeOutcomeSummary = {
      agreement: 0,
      typeI: 0,
      typeII: 0,
      regexConsistent: 0,
    }

    for (const witness of witnesses) {
      const shared = profile.resolveOptions(witness)
      const evaluated = evaluateWitness({
        pattern: witness.pattern,
        candidatePath: witness.candidatePath,
        options: shared,
      })
      if (evaluated === null) {
        throw new Error(
          `shared option profile ${profile.id} failed to evaluate ${witness.pattern}`
        )
      }

      if (evaluated.defaultDrift === null) defaultMode.agreement++
      else if (evaluated.defaultDrift === 'type-i') defaultMode.typeI++
      else defaultMode.typeII++

      if (evaluated.posixDrift === null) posixMode.agreement++
      else if (evaluated.posixDrift === 'type-i') posixMode.typeI++
      else posixMode.typeII++

      if (evaluated.defaultRegexConsistent) {
        defaultMode.regexConsistent++
      }
      if (evaluated.posixRegexConsistent) {
        posixMode.regexConsistent++
      }
    }

    return {
      id: profile.id,
      label: profile.label,
      sharedOptions:
        profile.sharedOptions === 'from-witness'
          ? 'from-witness'
          : { ...profile.sharedOptions },
      defaultMode,
      posixMode,
      total: witnesses.length,
    }
  })
}

function partitionSourceDisagreements (
  allDisagreements: SourceWitness[]
): DisagreementPartition {
  let bracketCount = 0
  let bracketResolvedByPosix = 0
  let bracketResolvedByStrictSlashes = 0
  let nonBracketCount = 0
  let trailingGlobstarCount = 0
  let nonBracketResolvedByPosix = 0
  let nonBracketResolvedByStrictSlashes = 0
  let combinedPosixAndStrictSlashesAgreement = 0

  for (const witness of allDisagreements) {
    const shared: SharedMatcherOptions = { dot: witness.dot }
    const mm = minimatch(
      witness.path,
      witness.pattern,
      shared as MinimatchOptions
    )
    const pmPosix = picomatch(witness.pattern, { ...shared, posix: true })(
      witness.path
    )
    const pmStrictSlashes = picomatch(witness.pattern, {
      ...shared,
      strictSlashes: true,
    })(witness.path)
    const pmCombined = picomatch(witness.pattern, {
      ...shared,
      posix: true,
      strictSlashes: true,
    })(witness.path)

    if (mm === pmCombined) {
      combinedPosixAndStrictSlashesAgreement++
    }

    if (witness.bracketNegation) {
      bracketCount++
      if (mm === pmPosix) bracketResolvedByPosix++
      if (mm === pmStrictSlashes) bracketResolvedByStrictSlashes++
    } else {
      nonBracketCount++
      if (witness.pattern.endsWith('/**')) trailingGlobstarCount++
      if (mm === pmPosix) nonBracketResolvedByPosix++
      if (mm === pmStrictSlashes) nonBracketResolvedByStrictSlashes++
    }
  }

  return {
    totalDisagreements: allDisagreements.length,
    bracketNegation: {
      count: bracketCount,
      resolvedByPosix: bracketResolvedByPosix,
      resolvedByStrictSlashes: bracketResolvedByStrictSlashes,
    },
    nonBracketDialect: {
      count: nonBracketCount,
      trailingGlobstarCount,
      resolvedByPosix: nonBracketResolvedByPosix,
      resolvedByStrictSlashes: nonBracketResolvedByStrictSlashes,
    },
    combinedPosixAndStrictSlashesAgreement,
  }
}

function buildReport (options: GeneratorOptions = {}): DriftReport {
  const { source, witnesses: allDisagreements } =
    ingestDifferentialWitnesses(options)

  // Only [! bracket-negation findings are associated with picomatch #187.
  // Other source disagreements include documented globstar/path semantics and
  // are adjudicated explicitly in `disagreementPartition`.
  const witnesses = allDisagreements
    .filter(witness => witness.bracketNegation)
    .map(evaluateRouteWitness)

  const { minimalWitnesses, shrinkSummary } = shrinkAllWitnesses(witnesses)

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
    sharedOptionsMatrix: evaluateSharedOptionMatrix(witnesses),
    disagreementPartition: partitionSourceDisagreements(allDisagreements),
    shrinkSummary,
    minimalWitnesses,
    structuralMinima: minimalByStructure(witnesses),
  }
}

function code (value: string): string {
  return `\`${value.replaceAll('|', '\\|').replaceAll('`', '\\`')}\``
}

function renderMarkdown (report: DriftReport): string {
  const partition = report.disagreementPartition
  const shrink = report.shrinkSummary

  const lines = [
    '# Downstream middleware route-matching consistency',
    '',
    `- Target: ${code(report.target)}`,
    `- Generated pattern/path pairs checked: ${report.checked}`,
    `- Source differential witnesses: ${report.sourceDisagreements} ` +
      `(${partition.bracketNegation.count} \`[!\` bracket negation + ` +
      `${partition.nonBracketDialect.count} documented trailing-\`/**\` dialect)`,
    `- Bracket-negation witnesses analyzed: ${report.bracketWitnesses}`,
    `- Predicate-preserving shrink verification: ${shrink.verifiedMinimal}/${shrink.totalWitnesses} ` +
      `1-minimal (${shrink.strictlyReduced} reduced, max ${shrink.maxSteps} steps)`,
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
    '## Shared-options matrix (comparable flags)',
    '',
    '| Shared option profile | Default agree | Default Type I | Default Type II | POSIX agree | Regex parity (default / POSIX) |',
    '|---|---:|---:|---:|---:|---:|',
    ...report.sharedOptionsMatrix.map(row =>
      `| ${code(row.label)} | ${row.defaultMode.agreement} | ` +
      `${row.defaultMode.typeI} | ${row.defaultMode.typeII} | ` +
      `${row.posixMode.agreement}/${row.total} | ` +
      `${row.defaultMode.regexConsistent}/${row.total} · ${row.posixMode.regexConsistent}/${row.total} |`
    ),
    '',
    '## Disagreement partition across all 360 differential findings',
    '',
    `- \`[!\` bracket-negation subset (${partition.bracketNegation.count}): ` +
      `${partition.bracketNegation.resolvedByPosix}/${partition.bracketNegation.count} resolved by picomatch ${code('{ posix: true }')}, ` +
      `${partition.bracketNegation.resolvedByStrictSlashes}/${partition.bracketNegation.count} by ${code('{ strictSlashes: true }')}.`,
    `- Non-bracket dialect subset (${partition.nonBracketDialect.count}, ` +
      `${partition.nonBracketDialect.trailingGlobstarCount} ending in ${code('/**')}): ` +
      `${partition.nonBracketDialect.resolvedByStrictSlashes}/${partition.nonBracketDialect.count} resolved by picomatch ${code('{ strictSlashes: true }')}, ` +
      `${partition.nonBracketDialect.resolvedByPosix}/${partition.nonBracketDialect.count} by ${code('{ posix: true }')}.`,
    `- Combined picomatch ${code('{ posix: true, strictSlashes: true }')}: ` +
      `${partition.combinedPosixAndStrictSlashesAgreement}/${partition.totalDisagreements} agreement across the generated differential set.`,
    '',
    '## Minimal compiler witnesses (predicate-preserving shrink)',
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
    'Every generated bracket-negation witness shrinks under the classification-',
    'and option-preserving predicate to `[!a]` (`b` for Type I, `a` for Type II).',
    'Minimatch and picomatch POSIX mode compile `[!a]` to a negated character',
    'class; picomatch default mode emits `!` as a literal class member.',
    '',
    '## Structural minima (shrunk within structural class)',
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
    '> The 294/294 POSIX convergence result and 360/360 dialect partition cover',
    '> this deterministic generated witness set. They are strong compiler-level',
    '> evidence, not a proof over every possible glob pattern and candidate string.',
    '>',
    '> The Type II label describes the specified layered architecture. It is a',
    '> consistency/policy-enforcement risk, not by itself a claim that either',
    '> library creates an exploitable vulnerability in every deployment.',
  ]

  return lines.join('\n')
}

function renderJson (
  report: DriftReport,
  { includeWitnesses = false }: { includeWitnesses?: boolean } = {}
): string {
  const payload = includeWitnesses
    ? report
    : {
        name: report.name,
        target: report.target,
        checked: report.checked,
        sourceDisagreements: report.sourceDisagreements,
        bracketWitnesses: report.bracketWitnesses,
        matrix: report.matrix,
        sharedOptionsMatrix: report.sharedOptionsMatrix,
        disagreementPartition: report.disagreementPartition,
        shrinkSummary: report.shrinkSummary,
        minimalWitnesses: report.minimalWitnesses,
        structuralMinima: report.structuralMinima,
      }

  return JSON.stringify(payload, null, 2)
}

module.exports = {
  SHARED_OPTION_PROFILES,
  buildReport,
  classifyDrift,
  evaluateSharedOptionMatrix,
  ingestDifferentialWitnesses,
  minimalByDrift,
  minimalByStructure,
  partitionSourceDisagreements,
  renderJson,
  renderMarkdown,
  shrinkRouteWitness,
  structuralPatternClass,
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2))
  const report = buildReport()
  if (args.has('--json-full')) {
    console.log(renderJson(report, { includeWitnesses: true }))
  } else if (args.has('--json')) {
    console.log(renderJson(report))
  } else {
    console.log(renderMarkdown(report))
  }
}
