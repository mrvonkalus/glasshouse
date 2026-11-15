# glasshouse

[![verify](https://github.com/mrvonkalus/glasshouse/actions/workflows/verify.yml/badge.svg)](https://github.com/mrvonkalus/glasshouse/actions/workflows/verify.yml)

Glasshouse is a deterministic testing lab for finding and explaining semantic
drift between widely used software components. It generates reproducible inputs,
compares independent implementations or checks invariants, preserves null
results, and reduces disagreements to evidence a maintainer can replay.

## Thirty-second demo

```bash
npm ci
npm run demo
```

The demo replays 40,000 seeded glob cases, shows the shortest observed Type I
and Type II route-matching witnesses, exposes the compiled regular expressions,
and verifies the `{ posix: true }` convergence result from live harness data.

For the complete harness suite and detailed Markdown or compact JSON report:

```bash
npm run verify
npm run --silent glob:middleware
npm run --silent glob:middleware:json
```

Every generator uses a seeded xorshift32. Results reproduce exactly instead of
depending on a lucky fuzzing run.

## Evidence status

**None of the findings are claimed as novel.** Tracker searches happened after
the independent finds. The repository currently contains one open correctness
defect, one open/contested matcher behavior, one adjudicated semver behavior,
and two clean harnesses:

| Observation | Status | Upstream |
|---|---|---|
| `semver.subset()` returns `true` for provably disjoint ranges | Open correctness defect | [node-semver PR #889](https://github.com/npm/node-semver/pull/889) |
| Picomatch default and POSIX bracket negation diverge | Open, contested default behavior | [picomatch #187](https://github.com/micromatch/picomatch/issues/187), [#180](https://github.com/micromatch/picomatch/issues/180), [#188](https://github.com/micromatch/picomatch/issues/188) |
| `semver` `ltr` and `gtr` both return `true` for an excluded prerelease | Expected behavior | [node-semver #328](https://github.com/npm/node-semver/issues/328) |
| Semver range invariants | Clean | No new finding |
| jsdiff round-trip invariants | Clean across 80,000 generated cases | No finding |

The signal is not a novelty claim. It is that small deterministic harnesses
independently reached known defects, distinguished documented differences from
defects, retained their own testing mistakes, and produced replayable witnesses.

---

## What the harnesses actually do

Two techniques, and the difference between them matters.

**Property testing** — state a rule the library must never break, then generate
inputs trying to break it. The risk is that *you can state the rule wrong*, and
then you get a pile of confident nonsense. That happened here twice; see below.

**Differential testing** — run independent implementations over the same inputs
and compare. This removes the need to hand-code a behavioral oracle, but a
disagreement is a signal rather than automatic proof of a defect: specifications,
defaults, and documented semantics still have to be adjudicated. The 66
non-bracket glob disagreements below are retained for exactly that reason.

| Harness | Technique | Result |
|---|---|---|
| `harnesses/semver-subset.js` | property | 8 unsound `subset()` results, each with a witness version |
| `harnesses/glob-brackets.js` | differential | 360 disagreements, 294 of them bracket negation |
| `harnesses/glob-middleware-drift.ts` | downstream differential projection | 190 Type I and 104 Type II route-matching drifts; `{ posix: true }` resolves all 294 |
| `harnesses/semver-invariants.js` | property | **clean** — 0 new findings |
| `harnesses/jsdiff-roundtrip.js` | property | **clean** — 0 findings in 80,000 cases |

### `semver.subset()`

The property: `subset(a, b) === true` ⟹ no version satisfies `a` but not `b`.

```js
semver.subset('1.0.0-alpha.0 <2.0.0', '<0.0.1')      // true — must be false

semver.satisfies('1.0.0-alpha.0', '1.0.0-alpha.0 <2.0.0')  // true  (in sub)
semver.satisfies('1.0.0-alpha.0', '<0.0.1')                // false (not in dom)
```

`subset` returns `true` for **any** super-range, including disjoint ones.

Root cause, `ranges/subset.js` lines 126–133 at 7.8.5: the emptiness test asks
`satisfies(eq, String(lt), options)` — testing the `eq` version against the bound
comparator *in isolation, stripped from its comparator set*. node-semver's
default prerelease gating requires some comparator **in the set** to carry a
matching prerelease tuple. The `=1.0.0-alpha.0` comparator is exactly that
vouching comparator, but it is excluded from the string being tested. The gate
fails, the set is misjudged as the null set, and "the null set is a subset of
everything" does the rest.

`patches/semver-subset-soundness-test.patch` adds a generative regression test to
node-semver's own suite. Against unpatched 7.8.5 it fails with named witnesses;
with PR #889 applied it passes; full suite `1..51`, 0 failures, eslint clean.

**The load-bearing observation:** node-semver's existing test suite is 100% green
*with and without* the fix. Zero failures either way, while the defect is
demonstrably present in the unpatched tree. The suite structurally cannot see
this class of bug. That is the argument for a property test.

### `picomatch` bracket negation

```js
picomatch('[!a]')('a')                   // true   — should be false
picomatch('[!a]')('b')                   // false  — should be true
picomatch('[!a]', { posix: true })('a')  // false  — correct
minimatch('a', '[!a]')                   // false  — correct
```

Visible in the generated regex:

```
picomatch  "[!a]"  ->  /^(?:(?:\[!a\]|[!a])\/?)$/
picomatch  "[^a]"  ->  /^(?:[^a\/]\/?)$/
```

`[^a]` is translated to a negated JS class. `[!a]` is emitted **raw** — and
JavaScript negates with `^`, not `!`, so JS reads `[!a]` as "the literal
characters `!` or `a`", the inverse of the POSIX/bash meaning. Affects every
position in a pattern, not only the leading one. `{ posix: true }` produces
correct behaviour, which is why this is a contested default rather than a
straightforward break — hence three open issues arguing about it.

### Downstream route-matching consistency

`glob-middleware-drift.ts` replays the bracket-negation witnesses in a layered
architecture: minimatch is the policy-filter layer and picomatch is the
router/static-resolver layer. It reads the generated witnesses directly from
`glob-brackets.js`; there is no copied fixture list to fall out of sync.

| Picomatch resolver mode | Agreement with minimatch policy | Type I | Type II | Total |
|---|---:|---:|---:|---:|
| default options | 0 | 190 | 104 | 294 |
| `{ posix: true }` | 294 | 0 | 0 | 294 |

A deterministic, predicate-preserving shrinker reduces every generated
bracket-negation witness while holding its drift classification, POSIX
convergence, and matcher option state invariant. Across all 294 generated
bracket-negation witnesses (`190` Type I and `104` Type II), reduction reaches
the same 1-minimal canonical pattern (`[!a]`, combined length five), and each
of the 17 structural placement groups is likewise shrunk within its structural
class:

| Type | Pattern | Input | minimatch RegExp | picomatch default RegExp | picomatch POSIX RegExp |
|---|---|---|---|---|---|
| I | `[!a]` | `b` | `^(?!\.)[^a]$` | `^(?:(?:\[!a\]\|[!a])\/?)$` | `^(?:[^a/]\/?)$` |
| II | `[!a]` | `a` | `^(?!\.)[^a]$` | `^(?:(?:\[!a\]\|[!a])\/?)$` | `^(?:[^a/]\/?)$` |

The compiler output makes the root cause visible: minimatch and picomatch
POSIX mode emit a negated character class, while picomatch default mode treats
`!` as a literal class member. Sweeping all six genuinely comparable shared
flags (`dot`, `nocase`, `nobrace`, `noglobstar`, `noext`, `nonegate`) preserves
`294/294` agreement under `{ posix: true }`, while picomatch `{ strictSlashes: true }`
resolves all `66/66` remaining trailing-`/**` dialect disagreements (`360/360`
combined). Both results are exhaustive for this deterministic generated witness
set; neither is a universal proof over every possible glob pattern and
candidate string.

- **Type I:** the minimatch policy matches, but the picomatch resolver rejects.
- **Type II:** the minimatch policy does not match a restricted-route rule,
  while the picomatch resolver matches the route.

The Type II model is a potential policy-enforcement gap in the specified
architecture, not a claim that every use of picomatch is exploitable. The
zero-framework regression suite uses only `node:test` and `node:assert`:

```bash
npm run test:middleware
```

---

## What this repo got wrong

Kept deliberately, because a hunt log that only lists hits is worthless.

Raw anomalies produced across the evening: **roughly 450. Real defects: 3.
Novel defects: 0.** The great majority of that noise was self-inflicted:

- **22 false `simplifyRange` findings.** The harness passed `simplifyRange` a
  pre-filtered list containing only *matching* versions, then compared the result
  against the full universe. Its contract is "same selection from the list you
  gave it" — `*` was a correct answer every time. Bug in the test. Invariant removed.
- **~400 false glob disagreements.** The path generator emitted empty segments,
  producing trailing slashes, double slashes and empty paths, where minimatch and
  picomatch diverge by documented design. Fixed by removing the empty segment;
  the count dropped from 402 to 360 and the character of the remainder changed
  entirely.
- **1 false trichotomy finding.** The range was empty. `ltr` and `gtr` are
  vacuously true over an empty set — correct behaviour.
- **A standalone test file** broke node-semver's `test/map.js`, which enforces
  1:1 correspondence between source and test files. Caught by their suite, not
  by inspection.
- **`t.plan(cases.length + 1)`** needed to be `+ 2`. Same.

Of the 360 surviving glob disagreements, only the 294 involving `[!` are tied to
picomatch #187. The other 66 are mostly globstar and trailing-path semantics that
these libraries are documented to treat differently, and are **not** claimed as
defects here.

---

## Why the null results are in the repo

`harnesses/jsdiff-roundtrip.js` finds nothing across 80,000 generated cases and
four separate invariants, with an input alphabet deliberately loaded with lines
that look like patch syntax (`---`, `+++`, `@@`, `\ No newline at end of file`).
jsdiff survives all of it. `harnesses/semver-invariants.js` likewise finds
nothing new.

Both are kept and both run in `npm run verify`. Anyone can publish hits.

---

## Provenance

The original fuzzing, analysis, and patches were produced by Claude working
under my direction on 2026-08-03. The middleware projection, compiler X-ray,
TypeScript suite, and demo were developed with Codex, with Gemini contributing
research and sequencing ideas. Rather than ask you to trust the agents or the
narrative: every result is reproducible with `npm run verify`, every generator
is seeded, and the upstream links are available for adjudication. The defects
belong to the people who reported them first, named and linked above.

MIT licensed. Nothing here is a security vulnerability; all three are correctness
defects, all three are already public, and no disclosure embargo applies.
