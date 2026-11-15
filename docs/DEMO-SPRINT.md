# Glasshouse demo sprint

## Objective

Ship a reproducible terminal demonstration that lets a security engineer or
maintainer understand Glasshouse's method, evidence, and limits in under 30
seconds.

The story is deliberately narrow:

> Two matchers receive the same route rule and normalized input, make different
> decisions, expose different compiler output, and converge across the generated
> witness set when picomatch enables POSIX semantics.

## Launch acceptance criteria

- `npm ci && npm run demo` works from a fresh checkout.
- The demo derives counts, witnesses, decisions, and regular expressions from
  the live deterministic harness rather than copied output.
- Output shows both drift directions and the layered Type II route simulation.
- Output shows the default and `{ posix: true }` comparison.
- Output clearly limits the claim to the generated witness set and does not
  label the behavior a universal proof or vulnerability.
- The terminal layout remains readable at 88 columns and works without color.
- `npm run typecheck`, `npm test`, and `npm run verify` pass.
- The README leads with the demo and accurately distinguishes open defects,
  expected behavior, and null results.
- A terminal recording, final post copy, and image alt text are reviewed before
  public launch.

## Sprint stages

### Stage 1 — Demo path

- Add `npm run demo`.
- Replay the shortest generated Type I and Type II witnesses.
- Display the compiler X-ray and the POSIX convergence matrix.
- Add deterministic output tests.

### Stage 2 — Evidence hardening

- Replace shortest-observed selection with predicate-preserving shrinking.
- Sweep shared matcher options and separate documented semantics from defects.
- Export compact JSON and Markdown artifacts from one report model.

### Stage 3 — Launch package

- Record the terminal demonstration.
- Add a README image or short clip.
- Draft and fact-check the X post and a longer portfolio explanation.
- Tag the reproducible launch commit.

### Stage 4 — Platform expansion

- Compare Node and Python glob behavior with explicit normalization contracts.
- Add a source-level call-site scanner for risky matcher configurations.
- Evaluate automata equivalence only after defining the supported glob language.

## Launch claims

Safe to say:

- Glasshouse replayed 40,000 deterministic pattern/path pairs at the pinned
  dependency versions.
- It isolated 294 generated bracket-negation disagreements: 190 Type I and 104
  Type II.
- Picomatch `{ posix: true }` agreed with minimatch for all 294 generated
  bracket-negation witnesses.
- Compiler output explains the shortest observed reproducer.

Do not say yet:

- The test proves equivalence for every possible glob and path.
- Every Type II disagreement is exploitable.
- The shortest observed witness is globally minimal.
- Every minimatch/picomatch disagreement is a library defect.

## Definition of done

The demo sprint is launch-ready when every acceptance criterion is checked,
the recording can be understood without narration, and a clean checkout
reproduces the post's exact claims.
