'use strict'

export {}

const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const test: typeof import('node:test') = require('node:test')
const { minimatch } = require('minimatch') as typeof import('minimatch')

type SharedMatcherOptions = Partial<
  Record<
    'dot' | 'nocase' | 'nobrace' | 'noglobstar' | 'noext' | 'nonegate',
    boolean
  >
>
type MatcherOptions = SharedMatcherOptions & { posix?: boolean }
type Picomatch = (
  pattern: string,
  options?: MatcherOptions
) => (candidatePath: string) => boolean

type DriftType = 'type-i' | 'type-ii' | null
type BaseDotState = 'from-witness' | boolean
type EffectiveOptionDescriptor = {
  dot: BaseDotState
  nocase: boolean
  nobrace: boolean
  noglobstar: boolean
  noext: boolean
  nonegate: boolean
}
type MatrixRow = {
  mode: 'default' | 'posix'
  agreement: number
  typeI: number
  typeII: number
  total: number
}
type SharedOptionMatrixRow = {
  id: string
  label: string
  baseDot: BaseDotState
  optionDelta: SharedMatcherOptions
  effectiveOptions: EffectiveOptionDescriptor
  affectedWitnesses: number
  corpusActive: boolean
  defaultMode: {
    agreement: number
    typeI: number
    typeII: number
    regexConsistent: number
  }
  posixMode: {
    agreement: number
    typeI: number
    typeII: number
    regexConsistent: number
  }
  total: number
}
type CompiledWitness = {
  pattern: string
  candidatePath: string
  dot: boolean
  defaultDrift: Exclude<DriftType, null>
  policyMatches: boolean
  resolverDefaultMatches: boolean
  resolverPosixMatches: boolean
  score: number
  structuralClass: string
  minimatchRegex: { source: string; flags: string }
  picomatchDefaultRegex: { source: string; flags: string }
  picomatchPosixRegex: { source: string; flags: string }
  shrink: {
    seedPattern: string
    seedCandidatePath: string
    seedScore: number
    steps: number
    minimal: boolean
  }
}
type DriftReport = {
  name: string
  target: string
  checked: number
  sourceDisagreements: number
  bracketWitnesses: number
  witnesses: Array<{
    pattern: string
    candidatePath: string
    dot: boolean
    policyMatches: boolean
    resolverDefaultMatches: boolean
    resolverPosixMatches: boolean
    defaultDrift: Exclude<DriftType, null>
    posixDrift: DriftType
  }>
  matrix: MatrixRow[]
  sharedOptionsMatrix: SharedOptionMatrixRow[]
  disagreementPartition: {
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
  shrinkSummary: {
    minimalityScope: 'reducer-neighborhood'
    totalWitnesses: number
    verifiedMinimal: number
    preservedClassification: number
    preservedOptions: number
    strictlyReduced: number
    maxSteps: number
    normalForms: Array<{
      driftType: Exclude<DriftType, null>
      pattern: string
      candidatePath: string
      dot: boolean
      count: number
    }>
  }
  minimalWitnesses: CompiledWitness[]
  structuralMinima: Array<{
    structuralClass: string
    driftType: Exclude<DriftType, null>
    witnessCount: number
    witness: CompiledWitness
  }>
}

const picomatch = require('picomatch') as Picomatch
const {
  buildReport,
  classifyDrift,
  renderJson,
  renderMarkdown,
  resolveEffectiveOptions,
  structuralPatternClass,
} = require('../harnesses/glob-middleware-drift') as {
  buildReport: () => DriftReport
  classifyDrift: (policy: boolean, resolver: boolean) => DriftType
  renderJson: (
    report: DriftReport,
    options?: { includeWitnesses?: boolean }
  ) => string
  renderMarkdown: (report: DriftReport) => string
  resolveEffectiveOptions: (
    effectiveOptions: EffectiveOptionDescriptor,
    witness: { dot: boolean }
  ) => SharedMatcherOptions
  structuralPatternClass: (pattern: string) => string
}

test('classifies both drift directions from the minimized bracket case', () => {
  const pattern = '[!a]'

  const policyIncludesB = minimatch('b', pattern)
  const defaultResolverIncludesB = picomatch(pattern)('b')
  assert.equal(policyIncludesB, true)
  assert.equal(defaultResolverIncludesB, false)
  assert.equal(
    classifyDrift(policyIncludesB, defaultResolverIncludesB),
    'type-i'
  )

  const policyIncludesA = minimatch('a', pattern)
  const defaultResolverIncludesA = picomatch(pattern)('a')
  assert.equal(policyIncludesA, false)
  assert.equal(defaultResolverIncludesA, true)
  assert.equal(
    classifyDrift(policyIncludesA, defaultResolverIncludesA),
    'type-ii'
  )
})

test('posix mode agrees with minimatch for the minimized bracket case', () => {
  for (const candidatePath of ['a', 'b']) {
    assert.equal(
      picomatch('[!a]', { posix: true })(candidatePath),
      minimatch(candidatePath, '[!a]')
    )
  }
})

test('ingests and classifies the deterministic source witness set', () => {
  const report = buildReport()

  assert.equal(report.checked, 40000)
  assert.equal(report.sourceDisagreements, 360)
  assert.equal(report.bracketWitnesses, 294)
  assert.equal(report.witnesses.length, 294)
  assert.equal(
    report.witnesses.filter(witness => witness.defaultDrift === 'type-i').length,
    190
  )
  assert.equal(
    report.witnesses.filter(witness => witness.defaultDrift === 'type-ii').length,
    104
  )
})

test('the options matrix shows posix mode resolving every bracket witness', () => {
  const { matrix, bracketWitnesses } = buildReport()

  assert.deepEqual(matrix, [
    {
      mode: 'default',
      agreement: 0,
      typeI: 190,
      typeII: 104,
      total: bracketWitnesses,
    },
    {
      mode: 'posix',
      agreement: 294,
      typeI: 0,
      typeII: 0,
      total: bracketWitnesses,
    },
  ])
})

test('shared-options matrix metadata matches effective evaluation and reports corpus activity', () => {
  const { sharedOptionsMatrix, bracketWitnesses, witnesses } = buildReport()
  assert.equal(sharedOptionsMatrix.length, 9)

  assert.deepEqual(
    sharedOptionsMatrix.map(row => ({
      id: row.id,
      baseDot: row.baseDot,
      affectedWitnesses: row.affectedWitnesses,
      corpusActive: row.corpusActive,
    })),
    [
      {
        id: 'witness-recorded',
        baseDot: 'from-witness',
        affectedWitnesses: 0,
        corpusActive: false,
      },
      {
        id: 'dot:false',
        baseDot: false,
        affectedWitnesses: 14,
        corpusActive: true,
      },
      {
        id: 'dot:true',
        baseDot: true,
        affectedWitnesses: 0,
        corpusActive: false,
      },
      {
        id: 'nocase:true',
        baseDot: 'from-witness',
        affectedWitnesses: 0,
        corpusActive: false,
      },
      {
        id: 'nobrace:true',
        baseDot: 'from-witness',
        affectedWitnesses: 14,
        corpusActive: true,
      },
      {
        id: 'noglobstar:true',
        baseDot: 'from-witness',
        affectedWitnesses: 60,
        corpusActive: true,
      },
      {
        id: 'noext:true',
        baseDot: 'from-witness',
        affectedWitnesses: 0,
        corpusActive: false,
      },
      {
        id: 'nonegate:true',
        baseDot: 'from-witness',
        affectedWitnesses: 0,
        corpusActive: false,
      },
      {
        id: 'all-shared:true',
        baseDot: true,
        affectedWitnesses: 74,
        corpusActive: true,
      },
    ]
  )

  for (const row of sharedOptionsMatrix) {
    assert.equal(row.total, bracketWitnesses)
    assert.deepEqual(row.effectiveOptions, {
      dot:
        row.optionDelta.dot !== undefined ? row.optionDelta.dot : row.baseDot,
      nocase: Boolean(row.optionDelta.nocase),
      nobrace: Boolean(row.optionDelta.nobrace),
      noglobstar: Boolean(row.optionDelta.noglobstar),
      noext: Boolean(row.optionDelta.noext),
      nonegate: Boolean(row.optionDelta.nonegate),
    })

    // Independently replay every witness from exported `effectiveOptions`
    // to verify metadata equals actual evaluation options.
    let defaultAgree = 0
    let defaultTypeI = 0
    let defaultTypeII = 0
    let posixAgree = 0
    let affected = 0

    for (const witness of witnesses) {
      const effective = resolveEffectiveOptions(row.effectiveOptions, witness)
      const mm = minimatch(witness.candidatePath, witness.pattern, effective)
      const pmDef = picomatch(witness.pattern, effective)(witness.candidatePath)
      const pmPosix = picomatch(witness.pattern, { ...effective, posix: true })(
        witness.candidatePath
      )

      if (
        mm !== witness.policyMatches ||
        pmDef !== witness.resolverDefaultMatches ||
        pmPosix !== witness.resolverPosixMatches
      ) {
        affected++
      }

      const defDrift = classifyDrift(mm, pmDef)
      if (defDrift === null) defaultAgree++
      else if (defDrift === 'type-i') defaultTypeI++
      else defaultTypeII++

      if (mm === pmPosix) posixAgree++
    }

    assert.equal(row.affectedWitnesses, affected)
    assert.equal(row.corpusActive, affected > 0)
    assert.equal(row.defaultMode.agreement, defaultAgree)
    assert.equal(row.defaultMode.typeI, defaultTypeI)
    assert.equal(row.defaultMode.typeII, defaultTypeII)
    assert.equal(row.posixMode.agreement, posixAgree)
    assert.equal(row.posixMode.agreement, bracketWitnesses)
    assert.equal(row.posixMode.typeI, 0)
    assert.equal(row.posixMode.typeII, 0)

    if (row.id === 'dot:false') {
      assert.equal(row.defaultMode.regexConsistent, 293)
      assert.equal(row.posixMode.regexConsistent, 293)
    } else {
      assert.equal(row.defaultMode.regexConsistent, bracketWitnesses)
      assert.equal(row.posixMode.regexConsistent, bracketWitnesses)
    }
  }
})

test('partitions all 360 source disagreements into [! bracket negation and trailing /** dialect', () => {
  const { disagreementPartition } = buildReport()

  assert.deepEqual(disagreementPartition, {
    totalDisagreements: 360,
    bracketNegation: {
      count: 294,
      resolvedByPosix: 294,
      resolvedByStrictSlashes: 4,
    },
    nonBracketDialect: {
      count: 66,
      trailingGlobstarCount: 66,
      resolvedByPosix: 0,
      resolvedByStrictSlashes: 66,
    },
    combinedPosixAndStrictSlashesAgreement: 360,
  })
})

test('shrinks every bracket witness to its reducer-canonical neighborhood-minimal form', () => {
  const { minimalWitnesses, shrinkSummary } = buildReport()

  assert.equal(shrinkSummary.minimalityScope, 'reducer-neighborhood')
  assert.equal(shrinkSummary.totalWitnesses, 294)
  assert.equal(shrinkSummary.verifiedMinimal, 294)
  assert.equal(shrinkSummary.preservedClassification, 294)
  assert.equal(shrinkSummary.preservedOptions, 294)
  assert.ok(shrinkSummary.strictlyReduced >= 288)
  assert.deepEqual(shrinkSummary.normalForms, [
    {
      driftType: 'type-i',
      pattern: '[!a]',
      candidatePath: 'b',
      dot: false,
      count: 90,
    },
    {
      driftType: 'type-i',
      pattern: '[!a]',
      candidatePath: 'b',
      dot: true,
      count: 100,
    },
    {
      driftType: 'type-ii',
      pattern: '[!a]',
      candidatePath: 'a',
      dot: false,
      count: 44,
    },
    {
      driftType: 'type-ii',
      pattern: '[!a]',
      candidatePath: 'a',
      dot: true,
      count: 60,
    },
  ])

  assert.deepEqual(
    minimalWitnesses.map(witness => ({
      type: witness.defaultDrift,
      pattern: witness.pattern,
      candidatePath: witness.candidatePath,
      dot: witness.dot,
      score: witness.score,
      minimal: witness.shrink.minimal,
    })),
    [
      {
        type: 'type-i',
        pattern: '[!a]',
        candidatePath: 'b',
        dot: false,
        score: 5,
        minimal: true,
      },
      {
        type: 'type-ii',
        pattern: '[!a]',
        candidatePath: 'a',
        dot: false,
        score: 5,
        minimal: true,
      },
    ]
  )
})

test('captures the exact compiler output for the minimal bracket pattern', () => {
  for (const witness of buildReport().minimalWitnesses) {
    assert.deepEqual(witness.minimatchRegex, {
      source: '^(?!\\.)[^a]$',
      flags: '',
    })
    assert.deepEqual(witness.picomatchDefaultRegex, {
      source: '^(?:(?:\\[!a\\]|[!a])\\/?)$',
      flags: '',
    })
    assert.deepEqual(witness.picomatchPosixRegex, {
      source: '^(?:[^a/]\\/?)$',
      flags: '',
    })
  }
})

test('groups witnesses by negated-class placement and shrinks each structural group', () => {
  const { structuralMinima, bracketWitnesses } = buildReport()

  assert.equal(structuralMinima.length, 17)
  assert.equal(
    structuralMinima.reduce((sum, group) => sum + group.witnessCount, 0),
    bracketWitnesses
  )
  assert.equal(
    structuralPatternClass('[!a]/literal/[!b]'),
    '3 segments; [! at 1, 3]'
  )
  assert.ok(structuralMinima.every(group => group.witness.shrink.minimal))

  const oneSegment = structuralMinima.filter(
    group => group.structuralClass === '1 segment; [! at 1]'
  )
  assert.deepEqual(
    oneSegment.map(group => ({
      type: group.driftType,
      pattern: group.witness.pattern,
      candidatePath: group.witness.candidatePath,
    })),
    [
      { type: 'type-ii', pattern: '[!a]', candidatePath: 'a' },
      { type: 'type-i', pattern: '[!a]', candidatePath: 'b' },
    ]
  )
})

test('compiled structural minima replay their recorded matcher outcomes', () => {
  for (const { witness } of buildReport().structuralMinima) {
    const replay = (compiled: { source: string; flags: string }) =>
      new RegExp(compiled.source, compiled.flags).test(witness.candidatePath)

    assert.equal(replay(witness.minimatchRegex), witness.policyMatches)
    assert.equal(
      replay(witness.picomatchDefaultRegex),
      witness.resolverDefaultMatches
    )
    assert.equal(
      replay(witness.picomatchPosixRegex),
      witness.resolverPosixMatches
    )
  }
})

test('exports compact JSON and Markdown artifacts from the same report model', () => {
  const report = buildReport()
  const compact = JSON.parse(renderJson(report)) as Record<string, unknown>
  const full = JSON.parse(
    renderJson(report, { includeWitnesses: true })
  ) as Record<string, unknown>
  const markdown = renderMarkdown(report)

  assert.equal('witnesses' in compact, false)
  assert.equal(compact.checked, report.checked)
  assert.equal(compact.sourceDisagreements, report.sourceDisagreements)
  assert.equal(compact.bracketWitnesses, report.bracketWitnesses)
  assert.deepEqual(compact.matrix, report.matrix)
  assert.deepEqual(compact.sharedOptionsMatrix, report.sharedOptionsMatrix)
  assert.deepEqual(compact.disagreementPartition, report.disagreementPartition)
  assert.deepEqual(compact.shrinkSummary, report.shrinkSummary)
  assert.equal(Array.isArray(full.witnesses), true)
  assert.match(markdown, /## Shared-options matrix \(comparable flags\)/)
  assert.match(markdown, /\| Effective shared options \| Affected witnesses \|/)
  assert.match(markdown, /non-regression checks on this corpus/)
  assert.match(markdown, /reducer-canonical/)
  assert.match(
    markdown,
    /1-minimal relative to this reducer's candidate neighborhood/
  )
  assert.match(markdown, /360\/360 agreement across the generated differential set/)
})

test('report generation is deterministic', () => {
  assert.deepEqual(buildReport(), buildReport())
})
