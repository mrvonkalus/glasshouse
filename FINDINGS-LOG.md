# Bug hunt session log — 2026-08-03

Method: property-based and differential testing. Generate inputs, check a rule
the library must never break, minimize failures, root-cause, **then check the
issue tracker before claiming anything.**

## Scoreboard

| # | Target | Finding | Real? | Novel? |
|---|---|---|---|---|
| 1 | `diff` (jsdiff) 9.0.0 | none — survived ~440k cases across 4 invariants × 4 context settings | — | — |
| 2 | `fast-json-patch` 3.1.1 | silent wrong patch on scalar document roots | Weak — out of declared type contract (`Object \| Array`); all nested cases pass | Not pursued |
| 3 | `semver` 7.8.5 | `subset()` false-positive: prerelease `eq` + differing bound ⇒ `true` for any superset | **Yes** | **No** — [PR #889](https://github.com/npm/node-semver/pull/889), filed 2026-07-23, open |
| 4 | `semver` 7.8.5 | `ltr` and `gtr` both `true` on a non-empty range | Yes, but | **No** — [#328](https://github.com/npm/node-semver/issues/328), closed 2023 as expected prerelease behavior |
| 5 | `picomatch` 4.0.5 | POSIX bracket negation `[!a]` inverted by default vs minimatch/bash | **Yes** | **No** — [#187](https://github.com/micromatch/picomatch/issues/187), [#180](https://github.com/micromatch/picomatch/issues/180), [#188](https://github.com/micromatch/picomatch/issues/188), all open |

## Own errors caught and discarded

Recorded because a hunt log that only lists hits is worthless.

- **22 false `simplifyRange` findings.** Passed a pre-filtered list of only
  matching versions, then compared against the full universe. `simplifyRange`'s
  contract is "same selection from the list given" — `*` was correct. My bug.
- **~400 false glob disagreements.** Path generator emitted empty segments,
  producing trailing slashes, double slashes, and empty paths — where minimatch
  and picomatch diverge by documented design. My bug.
- **1 false trichotomy finding.** Range was empty; `ltr`/`gtr` are vacuously
  true over an empty set. Correct behavior.
- **Standalone test file** broke `test/map.js` (1:1 source-to-test rule).
- **`t.plan(cases.length + 1)`** needed `+ 2`.

Raw anomalies produced: ~450. Real defects: 3. Novel defects: 0.

## Detail — picomatch bracket negation

```js
picomatch('[!a]')('a')                  // true   -- should be false
picomatch('[!a]')('b')                  // false  -- should be true
picomatch('[!a]', { posix: true })('a') // false  -- correct
minimatch('a', '[!a]')                  // false  -- correct
```

Root cause, visible in the generated regex:

```
picomatch  "[!a]"  ->  /^(?:(?:\[!a\]|[!a])\/?)$/
picomatch  "[^a]"  ->  /^(?:[^a\/]\/?)$/
```

`[!a]` is emitted as a raw JS character class. JavaScript negates with `^`, not
`!`, so JS reads `[!a]` as "the literal characters `!` or `a`" — the inverse of
the POSIX/bash meaning. `[^a]` is translated correctly. Affects every position in
a pattern, not just the leading one.

**Shape:** a token that means "negate" in the source language being passed
through to a target language where it means "literal." Data mistaken for syntax —
the same class as the jsdiff hypothesis that opened the session, and a cousin of
the `subset()` and Spout defects.

## Conclusion

The method reliably surfaces genuine defects in minutes. It did not surface a
novel one, because the top of the npm dependency tree is the most heavily fuzzed
code in the ecosystem. Novelty requires looking where fewer people look, not
where the impact is highest.

**Nothing submitted upstream. Nothing posted. No PR opened.**
