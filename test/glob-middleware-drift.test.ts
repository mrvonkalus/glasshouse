'use strict'

export {}

const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const test: typeof import('node:test') = require('node:test')
const { minimatch } = require('minimatch') as typeof import('minimatch')

type MatcherOptions = { dot?: boolean; posix?: boolean }
type Picomatch = (
  pattern: string,
  options?: MatcherOptions
) => (candidatePath: string) => boolean

type DriftType = 'type-i' | 'type-ii' | null
type MatrixRow = {
  mode: 'default' | 'posix'
  agreement: number
  typeI: number
  typeII: number
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
}
type DriftReport = {
  checked: number
  sourceDisagreements: number
  bracketWitnesses: number
  witnesses: Array<{
    defaultDrift: Exclude<DriftType, null>
    posixDrift: DriftType
  }>
  matrix: MatrixRow[]
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
  structuralPatternClass,
} = require('../harnesses/glob-middleware-drift') as {
  buildReport: () => DriftReport
  classifyDrift: (policy: boolean, resolver: boolean) => DriftType
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

test('selects the shortest deterministic witness for each drift direction', () => {
  const { minimalWitnesses } = buildReport()

  assert.deepEqual(
    minimalWitnesses.map(witness => ({
      type: witness.defaultDrift,
      pattern: witness.pattern,
      candidatePath: witness.candidatePath,
      dot: witness.dot,
      score: witness.score,
    })),
    [
      {
        type: 'type-i',
        pattern: '[!a]',
        candidatePath: 'b',
        dot: false,
        score: 5,
      },
      {
        type: 'type-ii',
        pattern: '[!a]',
        candidatePath: 'a',
        dot: false,
        score: 5,
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

test('groups witnesses by negated-class placement and minimizes each group', () => {
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

test('report generation is deterministic', () => {
  assert.deepEqual(buildReport(), buildReport())
})
