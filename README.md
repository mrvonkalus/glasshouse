# glasshouse

Property-based and differential test harnesses that independently rediscovered
three real, currently-open defects in npm packages drawing roughly **1.3 billion
weekly downloads** — in a single evening, on 2026-08-03.

```bash
npm install
npm run verify
```

Runs in a few seconds. Everything below reproduces exactly; every generator is
a seeded xorshift32, so there is no "run it a few times and see."

---

## Read this before anything else

**None of these findings are novel. Every one was reported by someone else
first.** The issue trackers were checked *after* each find, and in all three
cases somebody had already been there:

| Defect | Found here | Already reported |
|---|---|---|
| `semver.subset()` returns `true` for provably disjoint ranges | 2026-08-03 | [node-semver PR #889](https://github.com/npm/node-semver/pull/889), 2026-07-23, **open** |
| `picomatch` inverts POSIX bracket negation `[!a]` by default | 2026-08-03 | [picomatch #187](https://github.com/micromatch/picomatch/issues/187), also [#180](https://github.com/micromatch/picomatch/issues/180), [#188](https://github.com/micromatch/picomatch/issues/188), **all open** |
| `semver` `ltr` and `gtr` both `true` on a non-empty range | 2026-08-03 | [node-semver #328](https://github.com/npm/node-semver/issues/328), closed 2023 as expected prerelease behaviour |

If you are here to evaluate whether the method works, the fact that it landed on
three genuine defects in three attempts is the signal. The fact that it was
beaten to all three is the honest footnote, and it is stated up front rather
than buried.

---

## What the harnesses actually do

Two techniques, and the difference between them matters.

**Property testing** — state a rule the library must never break, then generate
inputs trying to break it. The risk is that *you can state the rule wrong*, and
then you get a pile of confident nonsense. That happened here twice; see below.

**Differential testing** — run two independent implementations of the same spec
and compare. You cannot state the rule wrong because you never state one. When
they disagree, one of them is wrong.

| Harness | Technique | Result |
|---|---|---|
| `harnesses/semver-subset.js` | property | 8 unsound `subset()` results, each with a witness version |
| `harnesses/glob-brackets.js` | differential | 360 disagreements, 294 of them bracket negation |
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

The fuzzing, analysis, patches and this README were produced by an AI agent
(Claude) working under my direction, over one session on 2026-08-03. Rather than
ask you to take that on trust: every result here is reproducible with
`npm run verify`, every generator is seeded, and the upstream links are right
there to check. The defects belong to the people who reported them first, named
and linked above.

MIT licensed. Nothing here is a security vulnerability; all three are correctness
defects, all three are already public, and no disclosure embargo applies.
