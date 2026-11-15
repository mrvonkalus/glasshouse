'use strict'

export {}

const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const test: typeof import('node:test') = require('node:test')
const { minimatch } = require('minimatch') as typeof import('minimatch')
const picomatch = require('picomatch') as {
  (
    pattern: string,
    options?: Record<string, unknown>
  ): (candidatePath: string) => boolean
  makeRe: (pattern: string, options?: Record<string, unknown>) => RegExp
}

type SharedOptionKey =
  | 'dot'
  | 'nocase'
  | 'nobrace'
  | 'noglobstar'
  | 'noext'
  | 'nonegate'

type SharedMatcherOptions = Partial<Record<SharedOptionKey, boolean>>
type DriftType = 'type-i' | 'type-ii'

type ShrinkableWitness = {
  pattern: string
  candidatePath: string
  options: SharedMatcherOptions
}

type ShrinkResult = {
  seed: ShrinkableWitness
  witness: ShrinkableWitness
  evaluation: {
    policyMatches: boolean
    resolverDefaultMatches: boolean
    resolverPosixMatches: boolean
    defaultDrift: DriftType | null
    posixDrift: DriftType | null
    bracketNegation: boolean
    regexConsistent: boolean
  }
  steps: number
  initialScore: number
  finalScore: number
  minimal: boolean
}

const { run: runGlobBrackets } = require('../harnesses/glob-brackets') as {
  run: () => {
    findings: Array<{
      pattern: string
      path: string
      dot: boolean
      bracketNegation: boolean
    }>
  }
}
const { structuralPatternClass } =
  require('../harnesses/glob-middleware-drift') as {
    structuralPatternClass: (pattern: string) => string
  }
const {
  SHARED_OPTION_KEYS,
  evaluateWitness,
  hasUnescapedBracketNegation,
  isOneMinimal,
  shrinkWitness,
} = require('../lib/glob-shrink') as {
  SHARED_OPTION_KEYS: readonly SharedOptionKey[]
  evaluateWitness: (witness: ShrinkableWitness) => ShrinkResult['evaluation'] | null
  hasUnescapedBracketNegation: (pattern: string) => boolean
  isOneMinimal: (
    witness: ShrinkableWitness,
    options?: {
      preserveStructure?: boolean
      structuralClassifier?: (pattern: string) => string
    }
  ) => boolean
  shrinkWitness: (
    seed: ShrinkableWitness,
    options?: {
      preserveStructure?: boolean
      structuralClassifier?: (pattern: string) => string
    }
  ) => ShrinkResult
}

test('every generated bracket witness preserves classification and dot option under reduction', () => {
  const bracketWitnesses = runGlobBrackets().findings.filter(
    finding => finding.bracketNegation
  )
  assert.equal(bracketWitnesses.length, 294)

  for (const finding of bracketWitnesses) {
    const seed: ShrinkableWitness = {
      pattern: finding.pattern,
      candidatePath: finding.path,
      options: { dot: finding.dot },
    }
    const baseline = evaluateWitness(seed)
    assert.notEqual(baseline, null)
    if (baseline === null) continue

    const result = shrinkWitness(seed)
    assert.equal(result.minimal, true)
    assert.equal(isOneMinimal(result.witness), true)
    assert.ok(result.finalScore <= result.initialScore)
    assert.deepEqual(result.witness.options, { dot: finding.dot })
    assert.equal(result.evaluation.defaultDrift, baseline.defaultDrift)
    assert.equal(result.evaluation.posixDrift, baseline.posixDrift)
    assert.equal(result.evaluation.bracketNegation, true)
    assert.equal(result.evaluation.regexConsistent, true)
    assert.equal(result.witness.pattern, '[!a]')
    assert.equal(
      result.witness.candidatePath,
      baseline.defaultDrift === 'type-i' ? 'b' : 'a'
    )
  }
})

test('all six comparable shared flags survive reduction and reach idempotent fixed points', () => {
  assert.deepEqual(SHARED_OPTION_KEYS, [
    'dot',
    'nocase',
    'nobrace',
    'noglobstar',
    'noext',
    'nonegate',
  ])

  const allSharedOptions: SharedMatcherOptions = {
    dot: true,
    nocase: true,
    nobrace: true,
    noglobstar: true,
    noext: true,
    nonegate: true,
  }

  const typeISeed: ShrinkableWitness = {
    pattern: '![!z]/*/{c,d}/.hidden',
    candidatePath: '!b/x/{c,d}/.hidden',
    options: allSharedOptions,
  }
  const typeIISeed: ShrinkableWitness = {
    pattern: '![!z]/*/{c,d}/.hidden',
    candidatePath: '!Z/x/{c,d}/.hidden',
    options: allSharedOptions,
  }

  const shrunkTypeI = shrinkWitness(typeISeed)
  assert.equal(shrunkTypeI.evaluation.defaultDrift, 'type-i')
  assert.equal(shrunkTypeI.evaluation.posixDrift, null)
  assert.deepEqual(shrunkTypeI.witness, {
    pattern: '[!a]',
    candidatePath: 'b',
    options: allSharedOptions,
  })
  assert.equal(shrinkWitness(shrunkTypeI.witness).steps, 0)

  const shrunkTypeII = shrinkWitness(typeIISeed)
  assert.equal(shrunkTypeII.evaluation.defaultDrift, 'type-ii')
  assert.equal(shrunkTypeII.evaluation.posixDrift, null)
  assert.deepEqual(shrunkTypeII.witness, {
    pattern: '[!a]',
    candidatePath: 'a',
    options: allSharedOptions,
  })
  assert.equal(shrinkWitness(shrunkTypeII.witness).steps, 0)

  // Compound witness where `noext: true` also triggers picomatch `(x|y)` regex
  // grouping (`posixDrift === 'type-i'`): shrinker must preserve `posixDrift`
  // rather than collapsing to `('[!a]', 'b')` where `posixDrift` would be `null`.
  const compoundNoext = shrinkWitness({
    pattern: '![!z]/+(x|y)/{c,d}',
    candidatePath: '!b/+(x|y)/{c,d}',
    options: allSharedOptions,
  })
  assert.equal(compoundNoext.evaluation.defaultDrift, 'type-i')
  assert.equal(compoundNoext.evaluation.posixDrift, 'type-i')
  assert.deepEqual(compoundNoext.witness.options, allSharedOptions)
  assert.equal(isOneMinimal(compoundNoext.witness), true)
})

test('nocase option flips witness classification and each branch preserves its own drift direction', () => {
  // Same (pattern, candidatePath) pair, opposite drift directions depending on `nocase`:
  // - nocase: false -> 'A' !== 'a', so minimatch=true, picomatch=false (type-i)
  // - nocase: true  -> 'A' =~  'a', so minimatch=false, picomatch=true (type-ii)
  const caseSensitive = shrinkWitness({
    pattern: 'B/[!a]/*',
    candidatePath: 'B/A/c',
    options: { nocase: false },
  })
  const caseInsensitive = shrinkWitness({
    pattern: 'B/[!a]/*',
    candidatePath: 'B/A/c',
    options: { nocase: true },
  })

  assert.equal(caseSensitive.evaluation.defaultDrift, 'type-i')
  assert.deepEqual(caseSensitive.witness, {
    pattern: '[!a]',
    candidatePath: 'b',
    options: { nocase: false },
  })

  assert.equal(caseInsensitive.evaluation.defaultDrift, 'type-ii')
  assert.deepEqual(caseInsensitive.witness, {
    pattern: '[!a]',
    candidatePath: 'a',
    options: { nocase: true },
  })
})

test('structure-preserving shrink simplifies wildcards without crossing structural classes', () => {
  const result = shrinkWitness(
    {
      pattern: '[^a]/[!z]/[!c]',
      candidatePath: 'b/z/c',
      options: { dot: false, noglobstar: true },
    },
    {
      preserveStructure: true,
      structuralClassifier: structuralPatternClass,
    }
  )

  assert.equal(
    structuralPatternClass(result.witness.pattern),
    '3 segments; [! at 2, 3]'
  )
  assert.equal(result.evaluation.defaultDrift, 'type-ii')
  assert.equal(result.evaluation.posixDrift, null)
  assert.deepEqual(result.witness, {
    pattern: 'a/[!a]/[!a]',
    candidatePath: 'a/a/a',
    options: { dot: false, noglobstar: true },
  })
  assert.equal(
    isOneMinimal(result.witness, {
      preserveStructure: true,
      structuralClassifier: structuralPatternClass,
    }),
    true
  )
})

test('unescaped bracket-negation detector distinguishes escaped and degenerate brackets', () => {
  assert.equal(hasUnescapedBracketNegation('[!a]'), true)
  assert.equal(hasUnescapedBracketNegation('\\\\[!a]'), true)
  assert.equal(hasUnescapedBracketNegation('[!]a]'), true)
  assert.equal(hasUnescapedBracketNegation('\\[!a]'), false)
  assert.equal(hasUnescapedBracketNegation('[a!b]'), false)
  assert.equal(hasUnescapedBracketNegation('[!]'), false)
  assert.equal(hasUnescapedBracketNegation('[!a'), false)
})

test('documents and guards known non-comparable option and makeRe traps', () => {
  // Trap 1: matchBase diverges on patterns containing slashes and is omitted by makeRe.
  assert.equal(minimatch('a/b', 'a/*', { matchBase: true }), true)
  assert.equal(picomatch('a/*', { matchBase: true })('a/b'), false)

  // Trap 2: picomatch.test short-circuits `input === glob` before regex execution.
  assert.equal(picomatch('[!a]', { posix: true })('[!a]'), true)
  assert.equal(picomatch.makeRe('[!a]', { posix: true }).test('[!a]'), false)

  // Trap 3: minimatch.makeRe diverges from minimatch() on `<seg>/**` + dotfile when dot:false.
  const mmDotFalseRe = minimatch.makeRe('[!a]/**', { dot: false })
  assert.notEqual(mmDotFalseRe, false)
  if (mmDotFalseRe !== false) {
    assert.equal(minimatch('c/.a', '[!a]/**', { dot: false }), false)
    assert.equal(mmDotFalseRe.test('c/.a'), true)
  }

  // Trap 4: under `noext: true`, minimatch escapes `(x|y)` while picomatch keeps regex parens/pipe.
  assert.equal(minimatch('+x/a', '+(x|y)/a', { noext: true }), false)
  assert.equal(picomatch('+(x|y)/a', { noext: true })('+x/a'), true)
})
