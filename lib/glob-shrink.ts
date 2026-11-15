'use strict'

export {}

// Deterministic, predicate-preserving witness shrinker for differential
// minimatch vs picomatch route-matching witnesses.
//
// Reduction holds the matcher option state invariant, preserves both default
// and `{ posix: true }` drift classifications, preserves unescaped `[!`
// bracket-negation presence, and halts at a verified 1-minimal fixed point
// under a strict well-founded tuple order.

const { minimatch } = require('minimatch') as typeof import('minimatch')

const SHARED_OPTION_KEYS = [
  'dot',
  'nocase',
  'nobrace',
  'noglobstar',
  'noext',
  'nonegate',
] as const

type SharedOptionKey = (typeof SHARED_OPTION_KEYS)[number]

type SharedMatcherOptions = Partial<Record<SharedOptionKey, boolean>>

type PicomatchOptions = SharedMatcherOptions & {
  posix?: boolean
  strictSlashes?: boolean
}

type Picomatch = {
  (
    pattern: string,
    options?: PicomatchOptions
  ): (candidatePath: string) => boolean
  makeRe: (pattern: string, options?: PicomatchOptions) => RegExp
}

const picomatch = require('picomatch') as Picomatch

type DriftType = 'type-i' | 'type-ii'

type ShrinkableWitness = {
  pattern: string
  candidatePath: string
  options: SharedMatcherOptions
}

type WitnessEvaluation = {
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

type ShrinkOptions = {
  preserveStructure?: boolean
  structuralClassifier?: (pattern: string) => string
  maxSteps?: number
}

type ShrinkResult = {
  seed: ShrinkableWitness
  witness: ShrinkableWitness
  evaluation: WitnessEvaluation
  steps: number
  candidatesTested: number
  initialScore: number
  finalScore: number
  minimal: boolean
}

type CompiledPatternEntry = {
  mmMatch: (candidatePath: string) => boolean
  pmDefaultMatch: (candidatePath: string) => boolean
  pmPosixMatch: (candidatePath: string) => boolean
  getRegexes: () => {
    mmRe: RegExp | false
    pmDefaultRe: RegExp
    pmPosixRe: RegExp
  }
}

const DEFAULT_MAX_SHRINK_STEPS = 1000
const patternCache = new Map<string, CompiledPatternEntry | null>()

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

function globMetaCount (pattern: string): number {
  return pattern.match(/[*?[\]{}()!@^+]/g)?.length ?? 0
}

function uppercaseCount (value: string): number {
  return value.match(/[A-Z]/g)?.length ?? 0
}

function witnessScore (witness: {
  pattern: string
  candidatePath: string
}): number {
  return witness.pattern.length + witness.candidatePath.length
}

// Strict well-founded total order on (pattern, candidatePath).
// `globMetaCount` and `uppercaseCount` precede raw codepoint comparison because
// ASCII sorts `*` (42), `?` (63), and `A`-`Z` (65-90) before `a`-`z` (97-122).
function compareShrinkTuple (
  left: { pattern: string; candidatePath: string },
  right: { pattern: string; candidatePath: string }
): number {
  const leftUpper =
    uppercaseCount(left.pattern) + uppercaseCount(left.candidatePath)
  const rightUpper =
    uppercaseCount(right.pattern) + uppercaseCount(right.candidatePath)

  return (
    witnessScore(left) - witnessScore(right) ||
    left.pattern.length - right.pattern.length ||
    left.candidatePath.length - right.candidatePath.length ||
    globMetaCount(left.pattern) - globMetaCount(right.pattern) ||
    leftUpper - rightUpper ||
    compareText(left.pattern, right.pattern) ||
    compareText(left.candidatePath, right.candidatePath)
  )
}

function cloneSharedOptions (
  options: SharedMatcherOptions
): SharedMatcherOptions {
  const copy: SharedMatcherOptions = {}
  for (const key of SHARED_OPTION_KEYS) {
    if (options[key] !== undefined) {
      copy[key] = options[key]
    }
  }
  return copy
}

function sharedOptionsEqual (
  left: SharedMatcherOptions,
  right: SharedMatcherOptions
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false

  for (let i = 0; i < leftKeys.length; i++) {
    const key = leftKeys[i] as SharedOptionKey
    if (key !== rightKeys[i] || left[key] !== right[key]) {
      return false
    }
  }
  return true
}

function optionsCacheKey (options: SharedMatcherOptions): string {
  return SHARED_OPTION_KEYS
    .map(key => (options[key] === true ? '1' : '0'))
    .join('')
}

function sanitizeSharedOptions (
  options: SharedMatcherOptions
): SharedMatcherOptions {
  const clean: SharedMatcherOptions = {}
  for (const key of SHARED_OPTION_KEYS) {
    if (typeof options[key] === 'boolean') {
      clean[key] = options[key]
    }
  }
  return clean
}

// Detects an unescaped POSIX-style negated bracket expression `[!...]` with a
// matching closing `]` after at least one class member.
function hasUnescapedBracketNegation (pattern: string): boolean {
  let escaped = false
  let inBracket = false

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (!inBracket && ch === '[') {
      if (pattern.indexOf(']', i + 1) === -1) continue
      if (pattern[i + 1] === '!' && pattern.indexOf(']', i + 3) !== -1) {
        return true
      }
      inBracket = true
      continue
    }
    if (inBracket && ch === ']') {
      inBracket = false
    }
  }

  return false
}

function hasRelativeDotSegment (candidatePath: string): boolean {
  return candidatePath
    .split('/')
    .some(segment => segment === '.' || segment === '..')
}

function isValidPattern (pattern: string): boolean {
  if (pattern.length === 0) return false
  return pattern.split('/').every(segment => segment.length > 0)
}

function isValidNormalizedPath (
  candidatePath: string,
  allowRelativeDots: boolean
): boolean {
  if (candidatePath.length === 0) return false
  const segments = candidatePath.split('/')
  return segments.every(
    segment =>
      segment.length > 0 &&
      (allowRelativeDots || (segment !== '.' && segment !== '..'))
  )
}

function compilePatternEntry (
  pattern: string,
  options: SharedMatcherOptions
): CompiledPatternEntry | null {
  const key = `${optionsCacheKey(options)}\u0000${pattern}`
  if (patternCache.has(key)) {
    return patternCache.get(key) ?? null
  }

  const clean = sanitizeSharedOptions(options)
  try {
    const mmFilter = minimatch.filter(pattern, clean)
    const pmDefaultMatch = picomatch(pattern, clean)
    const pmPosixMatch = picomatch(pattern, { ...clean, posix: true })

    let cachedRegexes: {
      mmRe: RegExp | false
      pmDefaultRe: RegExp
      pmPosixRe: RegExp
    } | null = null

    const entry: CompiledPatternEntry = {
      mmMatch: mmFilter,
      pmDefaultMatch,
      pmPosixMatch,
      getRegexes: () => {
        if (cachedRegexes === null) {
          cachedRegexes = {
            mmRe: minimatch.makeRe(pattern, clean),
            pmDefaultRe: picomatch.makeRe(pattern, clean),
            pmPosixRe: picomatch.makeRe(pattern, { ...clean, posix: true }),
          }
        }
        return cachedRegexes
      },
    }

    patternCache.set(key, entry)
    return entry
  } catch {
    patternCache.set(key, null)
    return null
  }
}

function evaluateWitness (witness: ShrinkableWitness): WitnessEvaluation | null {
  const compiled = compilePatternEntry(witness.pattern, witness.options)
  if (compiled === null) return null

  try {
    const { mmRe, pmDefaultRe, pmPosixRe } = compiled.getRegexes()
    if (mmRe === false) return null

    const policyMatches = compiled.mmMatch(witness.candidatePath)
    const resolverDefaultMatches = compiled.pmDefaultMatch(witness.candidatePath)
    const resolverPosixMatches = compiled.pmPosixMatch(witness.candidatePath)

    const mmConsistent = mmRe.test(witness.candidatePath) === policyMatches
    const defaultRegexConsistent =
      mmConsistent &&
      pmDefaultRe.test(witness.candidatePath) === resolverDefaultMatches
    const posixRegexConsistent =
      mmConsistent &&
      pmPosixRe.test(witness.candidatePath) === resolverPosixMatches
    const regexConsistent = defaultRegexConsistent && posixRegexConsistent

    return {
      policyMatches,
      resolverDefaultMatches,
      resolverPosixMatches,
      defaultDrift: classifyDrift(policyMatches, resolverDefaultMatches),
      posixDrift: classifyDrift(policyMatches, resolverPosixMatches),
      bracketNegation: hasUnescapedBracketNegation(witness.pattern),
      defaultRegexConsistent,
      posixRegexConsistent,
      regexConsistent,
    }
  } catch {
    return null
  }
}

// Fast predicate check that avoids `makeRe` compilation when runtime boolean
// outcomes already reject a candidate.
function matchesShrinkPredicate (
  candidate: ShrinkableWitness,
  seed: ShrinkableWitness,
  baseline: WitnessEvaluation,
  allowRelativeDots: boolean
): WitnessEvaluation | null {
  if (
    !isValidPattern(candidate.pattern) ||
    !isValidNormalizedPath(candidate.candidatePath, allowRelativeDots) ||
    !sharedOptionsEqual(candidate.options, seed.options)
  ) {
    return null
  }

  const bracketNegation = hasUnescapedBracketNegation(candidate.pattern)
  if (bracketNegation !== baseline.bracketNegation) {
    return null
  }

  const compiled = compilePatternEntry(candidate.pattern, candidate.options)
  if (compiled === null) return null

  let policyMatches: boolean
  let resolverDefaultMatches: boolean
  let resolverPosixMatches: boolean
  try {
    policyMatches = compiled.mmMatch(candidate.candidatePath)
    resolverDefaultMatches = compiled.pmDefaultMatch(candidate.candidatePath)
    if (
      classifyDrift(policyMatches, resolverDefaultMatches) !==
      baseline.defaultDrift
    ) {
      return null
    }

    resolverPosixMatches = compiled.pmPosixMatch(candidate.candidatePath)
    if (
      classifyDrift(policyMatches, resolverPosixMatches) !==
      baseline.posixDrift
    ) {
      return null
    }
  } catch {
    return null
  }

  const { mmRe, pmDefaultRe, pmPosixRe } = compiled.getRegexes()
  if (mmRe === false) return null

  const mmConsistent = mmRe.test(candidate.candidatePath) === policyMatches
  const defaultRegexConsistent =
    mmConsistent &&
    pmDefaultRe.test(candidate.candidatePath) === resolverDefaultMatches
  const posixRegexConsistent =
    mmConsistent &&
    pmPosixRe.test(candidate.candidatePath) === resolverPosixMatches
  const regexConsistent = defaultRegexConsistent && posixRegexConsistent

  if (baseline.regexConsistent && !regexConsistent) {
    return null
  }

  return {
    policyMatches,
    resolverDefaultMatches,
    resolverPosixMatches,
    defaultDrift: baseline.defaultDrift,
    posixDrift: baseline.posixDrift,
    bracketNegation,
    defaultRegexConsistent,
    posixRegexConsistent,
    regexConsistent,
  }
}

function generateShrinkCandidates (
  current: ShrinkableWitness,
  preserveStructure: boolean
): Array<{ pattern: string; candidatePath: string }> {
  const candidates: Array<{ pattern: string; candidatePath: string }> = []
  const seen = new Set<string>()
  const push = (pattern: string, candidatePath: string): void => {
    const key = `${pattern}\u0000${candidatePath}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ pattern, candidatePath })
  }

  const patternSegments = current.pattern.split('/')
  const pathSegments = current.candidatePath.split('/')

  // Pass 1: Coarse segment reduction (skipped when preserving structural class).
  if (!preserveStructure) {
    if (patternSegments.length > 1 || pathSegments.length > 1) {
      for (const patternSegment of patternSegments) {
        for (const pathSegment of pathSegments) {
          push(patternSegment, pathSegment)
        }
      }
    }

    if (patternSegments.length > 1 && pathSegments.length > 1) {
      const aligned = Math.min(patternSegments.length, pathSegments.length)
      for (let i = 0; i < aligned; i++) {
        push(
          patternSegments.filter((_, index) => index !== i).join('/'),
          pathSegments.filter((_, index) => index !== i).join('/')
        )
      }
    }

    if (patternSegments.length > 1) {
      for (let i = 0; i < patternSegments.length; i++) {
        push(
          patternSegments.filter((_, index) => index !== i).join('/'),
          current.candidatePath
        )
      }
    }

    if (pathSegments.length > 1) {
      for (let j = 0; j < pathSegments.length; j++) {
        push(
          current.pattern,
          pathSegments.filter((_, index) => index !== j).join('/')
        )
      }
    }
  }

  // Pass 2: Segment-level construct simplification and coupled normalization.
  for (let i = 0; i < patternSegments.length; i++) {
    for (let j = 0; j < pathSegments.length; j++) {
      for (const literal of ['a', 'b']) {
        if (patternSegments[i] !== literal || pathSegments[j] !== literal) {
          const nextPattern = [...patternSegments]
          const nextPath = [...pathSegments]
          nextPattern[i] = literal
          nextPath[j] = literal
          push(nextPattern.join('/'), nextPath.join('/'))
        }
      }

      // Coupled core extraction when a segment wraps `[!...]` in affixes
      // (for example `![!a]` against `!b` under `{ nonegate: true }`).
      if (hasUnescapedBracketNegation(patternSegments[i])) {
        for (const pathLiteral of ['a', 'b']) {
          const nextPattern = [...patternSegments]
          const nextPath = [...pathSegments]
          nextPattern[i] = '[!a]'
          nextPath[j] = pathLiteral
          push(nextPattern.join('/'), nextPath.join('/'))
        }
      }
    }
  }

  for (let i = 0; i < patternSegments.length; i++) {
    for (const replacement of ['a', 'b', '[!a]']) {
      if (patternSegments[i] !== replacement) {
        const nextPattern = [...patternSegments]
        nextPattern[i] = replacement
        push(nextPattern.join('/'), current.candidatePath)
      }
    }

    const negatedClass = patternSegments[i].match(/\[!([^\]]+)\]/)
    if (negatedClass !== null) {
      const firstMember = negatedClass[1][0]
      for (const member of ['a', firstMember]) {
        const simplified = patternSegments[i].replace(
          /\[![^\]]+\]/,
          `[!${member}]`
        )
        if (simplified !== patternSegments[i]) {
          const nextPattern = [...patternSegments]
          nextPattern[i] = simplified
          push(nextPattern.join('/'), current.candidatePath)
        }
      }
    }
  }

  for (let j = 0; j < pathSegments.length; j++) {
    for (const replacement of ['a', 'b']) {
      if (pathSegments[j] !== replacement) {
        const nextPath = [...pathSegments]
        nextPath[j] = replacement
        push(current.pattern, nextPath.join('/'))
      }
    }
  }

  // Pass 3: Within-segment single-character deletion.
  for (let j = 0; j < pathSegments.length; j++) {
    const segment = pathSegments[j]
    if (segment.length > 1) {
      for (let k = 0; k < segment.length; k++) {
        const nextPath = [...pathSegments]
        nextPath[j] = segment.slice(0, k) + segment.slice(k + 1)
        push(current.pattern, nextPath.join('/'))
      }
    }
  }

  for (let i = 0; i < patternSegments.length; i++) {
    const segment = patternSegments[i]
    if (segment.length > 1) {
      for (let k = 0; k < segment.length; k++) {
        const nextPattern = [...patternSegments]
        nextPattern[i] = segment.slice(0, k) + segment.slice(k + 1)
        push(nextPattern.join('/'), current.candidatePath)
      }
    }
  }

  // Pass 4: Single-character lexical canonicalization toward `'a'`, `'b'`.
  for (let i = 0; i < current.pattern.length; i++) {
    const ch = current.pattern[i]
    if (/[a-zA-Z0-9_]/.test(ch)) {
      for (const replacement of ['a', 'b']) {
        if (ch !== replacement) {
          push(
            current.pattern.slice(0, i) +
              replacement +
              current.pattern.slice(i + 1),
            current.candidatePath
          )
        }
      }
    }
  }

  for (let j = 0; j < current.candidatePath.length; j++) {
    const ch = current.candidatePath[j]
    if (/[a-zA-Z0-9_]/.test(ch)) {
      for (const replacement of ['a', 'b']) {
        if (ch !== replacement) {
          push(
            current.pattern,
            current.candidatePath.slice(0, j) +
              replacement +
              current.candidatePath.slice(j + 1)
          )
        }
      }
    }
  }

  return candidates
}

function shrinkWitness (
  seedInput: ShrinkableWitness,
  {
    preserveStructure = false,
    structuralClassifier,
    maxSteps = DEFAULT_MAX_SHRINK_STEPS,
  }: ShrinkOptions = {}
): ShrinkResult {
  const seed: ShrinkableWitness = {
    pattern: seedInput.pattern,
    candidatePath: seedInput.candidatePath,
    options: cloneSharedOptions(seedInput.options),
  }

  if (preserveStructure && structuralClassifier === undefined) {
    throw new Error(
      'preserveStructure requires a structuralClassifier function'
    )
  }

  const allowRelativeDots = hasRelativeDotSegment(seed.candidatePath)
  if (
    !isValidPattern(seed.pattern) ||
    !isValidNormalizedPath(seed.candidatePath, allowRelativeDots)
  ) {
    throw new Error(
      `invalid seed witness: ${JSON.stringify({
        pattern: seed.pattern,
        candidatePath: seed.candidatePath,
      })}`
    )
  }

  const initialEvaluation = evaluateWitness(seed)
  if (initialEvaluation === null || initialEvaluation.defaultDrift === null) {
    throw new Error(
      `seed witness does not exhibit default matcher drift: ${JSON.stringify({
        pattern: seed.pattern,
        candidatePath: seed.candidatePath,
        options: seed.options,
      })}`
    )
  }

  const seedStructure =
    preserveStructure && structuralClassifier
      ? structuralClassifier(seed.pattern)
      : null

  let current: ShrinkableWitness = {
    pattern: seed.pattern,
    candidatePath: seed.candidatePath,
    options: cloneSharedOptions(seed.options),
  }
  let currentEvaluation = initialEvaluation
  let steps = 0
  let candidatesTested = 0

  while (steps < maxSteps) {
    let accepted = false
    const neighbors = generateShrinkCandidates(current, preserveStructure)

    for (const neighbor of neighbors) {
      if (compareShrinkTuple(neighbor, current) >= 0) {
        continue
      }
      if (
        seedStructure !== null &&
        structuralClassifier !== undefined &&
        structuralClassifier(neighbor.pattern) !== seedStructure
      ) {
        continue
      }

      candidatesTested++
      const candidate: ShrinkableWitness = {
        pattern: neighbor.pattern,
        candidatePath: neighbor.candidatePath,
        options: cloneSharedOptions(seed.options),
      }
      const evaluation = matchesShrinkPredicate(
        candidate,
        seed,
        initialEvaluation,
        allowRelativeDots
      )
      if (evaluation !== null) {
        current = candidate
        currentEvaluation = evaluation
        steps++
        accepted = true
        break
      }
    }

    if (!accepted) {
      return {
        seed,
        witness: current,
        evaluation: currentEvaluation,
        steps,
        candidatesTested,
        initialScore: witnessScore(seed),
        finalScore: witnessScore(current),
        minimal: true,
      }
    }
  }

  throw new Error(`shrinkWitness exceeded maxSteps (${maxSteps})`)
}

function isOneMinimal (
  witness: ShrinkableWitness,
  {
    preserveStructure = false,
    structuralClassifier,
  }: Omit<ShrinkOptions, 'maxSteps'> = {}
): boolean {
  const baseline = evaluateWitness(witness)
  if (baseline === null || baseline.defaultDrift === null) return false

  const allowRelativeDots = hasRelativeDotSegment(witness.candidatePath)
  const targetStructure =
    preserveStructure && structuralClassifier
      ? structuralClassifier(witness.pattern)
      : null

  for (const neighbor of generateShrinkCandidates(witness, preserveStructure)) {
    if (compareShrinkTuple(neighbor, witness) >= 0) continue
    if (
      targetStructure !== null &&
      structuralClassifier !== undefined &&
      structuralClassifier(neighbor.pattern) !== targetStructure
    ) {
      continue
    }

    const candidate: ShrinkableWitness = {
      pattern: neighbor.pattern,
      candidatePath: neighbor.candidatePath,
      options: cloneSharedOptions(witness.options),
    }
    if (
      matchesShrinkPredicate(
        candidate,
        witness,
        baseline,
        allowRelativeDots
      ) !== null
    ) {
      return false
    }
  }

  return true
}

module.exports = {
  SHARED_OPTION_KEYS,
  classifyDrift,
  cloneSharedOptions,
  compareShrinkTuple,
  evaluateWitness,
  generateShrinkCandidates,
  globMetaCount,
  hasUnescapedBracketNegation,
  isOneMinimal,
  sharedOptionsEqual,
  shrinkWitness,
  witnessScore,
}
