# Phase 1 open hunt — null result log

**Date:** 2026-08-03
**Target:** npm/node-semver @ `6e05b76` (7.8.5) **with PR #889 applied**, so the
known `subset()` defect cannot account for anything found here.
**Harness:** `hunt.js` — 15,000 generated ranges × 2 option sets × 144-version universe.

Recording negatives deliberately. A hunt that only ever reports hits is not a
hunt, it's a press release.

## Invariants checked

1. `minVersion(r)` must satisfy `r`
2. `simplifyRange(versions, r)` must select the same versions as `r`
3. `maxSatisfying` / `minSatisfying` must be in-range and actually extremal
4. Trichotomy — at most one of `ltr(v,r)` / `gtr(v,r)` / `satisfies(v,r)`
5. `outside()` must agree with `ltr` / `gtr`

## Results — 25 raw anomalies, 0 real bugs

| count | anomaly | disposition |
|---|---|---|
| 22 | `simplifyRange` selection mismatch | **Harness bug (mine).** I passed a pre-filtered list of only *matching* versions, then compared the result against the full universe. `simplifyRange`'s contract is "same selection from the list you gave it" — `*` is a correct simplification of a list containing only matches. Invalid test, discarded. |
| 1 | `ltr` and `gtr` both true — `^1.x.* ~2.2.2-beta.1` | **Correct behavior.** Normalizes to `>=1.0.0 <2.0.0-0 >=2.2.2-beta.1`, an empty range. Both predicates are vacuously true over an empty set. |
| 2 | `ltr` and `gtr` both true, range non-empty | **Known, closed as expected.** See below. |

`minVersion`, `maxSatisfying`, `minSatisfying` produced no anomalies at all.

## On the two surviving cases

```js
ltr('2.0.1-beta.1', '>=2.0.0 <3.0.0-0')  // true
gtr('2.0.1-beta.1', '>=2.0.0 <3.0.0-0')  // true
// range is non-empty (2.0.0, 2.0.1, 2.0.2, ... all satisfy)
// 2.0.0 < 2.0.1-beta.1 < 2.0.2, so neither claim holds
```

Logically incoherent — a version cannot be below every member *and* above every
member of a non-empty set. Root cause is prerelease gating: the version falls
inside the range's numeric span but is excluded by the prerelease rules, and
`outside()` has no way to express "excluded, but not by ordering."

**Already adjudicated.** [Issue #328](https://github.com/npm/node-semver/issues/328)
raised this class in 2023 and was closed by maintainer `wraithgar`:
*"The prerelease tags are the reason for the apparent inconsistency."*

The framing here is stronger than #328's (simultaneous `ltr`+`gtr` on a non-empty
range, versus #328's two individually-suspect claims). That is not sufficient
grounds to reopen a three-year-old maintainer decision. **Not reported.**

## Status

No new defect found. Nothing to submit from this sweep.
