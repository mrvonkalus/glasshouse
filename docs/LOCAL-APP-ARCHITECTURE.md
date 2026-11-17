# Glasshouse local application architecture

## Purpose

Turn Glasshouse into a local differential-testing workbench without weakening
the deterministic command-line harnesses that make its evidence reproducible.
The interface is a second presentation layer over one typed result model, not a
separate implementation of the research logic.

The first application milestone remains deliberately narrow: render and replay
the existing glob route-drift experiment. New targets become adapters only after
the first adapter proves that the core boundary is reusable.

## Product principles

1. **One engine, two explanations.** Advanced and Vibe Coder modes consume the
   same run events and final report. Changing modes never changes an experiment.
2. **CLI parity.** Every experiment that the interface can start can be saved,
   replayed, and inspected without the interface.
3. **Evidence before interpretation.** Raw decisions, versions, options, seeds,
   and minimized witnesses remain available beneath every explanation.
4. **Claims have boundaries.** The interface distinguishes observed
   disagreement, potential architectural impact, and demonstrated exploitability.
5. **Local by default.** The application binds to loopback, has no telemetry,
   and does not require an account or cloud service.
6. **Untrusted adapters are isolated.** Comparator code does not inherit network,
   credential, or unrestricted filesystem access from the interface process.

## User modes

### Vibe Coder mode

This mode teaches the experiment without hiding its evidence.

- guided experiment setup with safe presets;
- plain-language descriptions of subjects, inputs, and invariants;
- a visual route from generated cases to drift classes to minimized witnesses;
- contextual explanations for matcher options and compiled output;
- an **Explain this** control with beginner, practitioner, and maintainer depth;
- explicit callouts for what the result does and does not establish; and
- one-click copying of the exact replay command and regression test.

### Advanced mode

This mode is an operational research surface rather than a decorated report.

- editable experiment manifests and deterministic seeds;
- subject, runtime, dependency-version, and option matrices;
- live event stream with progress, timings, failures, and cancellation;
- corpus import and generator configuration;
- raw subject decisions and compiled artifacts;
- drift clustering, reducer traces, structural classes, and invariant state;
- normalized JSON, Markdown, and test-fixture export;
- version-to-version comparison and later automated bisection; and
- a headless command that reproduces every saved run.

## Proposed component boundary

```text
Glasshouse core
  generators -> adapters -> oracle -> classifier -> reducer -> report
       |                                                    |
       +---------------- typed run events ------------------+
                              |
                    local application service
                   /                          \
          command-line interface        browser interface
                                        /               \
                               Vibe Coder mode     Advanced mode
```

### Core

The core owns experiment semantics. It must not import UI code or format terminal
output. Its initial public boundary should be small:

```ts
type RunEvent =
  | { type: 'run-started'; runId: string; manifest: ExperimentManifest }
  | { type: 'progress'; checked: number; total?: number }
  | { type: 'witness-found'; witness: DifferentialWitness }
  | { type: 'witness-reduced'; result: ReductionResult }
  | { type: 'run-completed'; report: ExperimentReport }
  | { type: 'run-failed'; error: SerializableRunError }

interface ExperimentRunner {
  run(
    manifest: ExperimentManifest,
    signal?: AbortSignal
  ): AsyncIterable<RunEvent>
}
```

The existing glob harness is adapted to this interface before any generic plugin
system is introduced. The current CLI remains available while the boundary is
extracted.

### Local application service

The service coordinates runs and serves static interface assets. It should:

- bind only to an explicit loopback address;
- choose an available ephemeral port unless the user supplies one;
- use an unguessable per-launch token for state-changing requests;
- validate manifests and adapter output at the process boundary;
- enforce run timeouts, cancellation, output limits, and concurrency limits;
- write artifacts only to a user-selected workspace; and
- avoid opening arbitrary URLs, shells, or files from report content.

The service does not reinterpret results. It transports typed core events and
stores artifacts produced from the same final report model as the CLI.

### Browser interface

The browser interface renders run state and report data. Explanations are keyed
to stable report fields and reason codes rather than inferred from display text.
Advanced and Vibe Coder views can therefore disagree in detail level but cannot
disagree about the underlying result.

## Experiment manifest

A versioned manifest is the reproducibility contract. A first glob manifest
could resemble:

```json
{
  "schemaVersion": 1,
  "adapter": "glob-route-drift",
  "seed": 3737844653,
  "iterations": 40000,
  "subjects": [
    { "id": "minimatch", "version": "10.2.6", "role": "policy" },
    { "id": "picomatch", "version": "4.0.5", "role": "resolver" }
  ],
  "options": {
    "matrix": ["recorded", "posix"]
  },
  "reduction": {
    "enabled": true,
    "predicate": "preserve-drift-and-compiler-parity"
  }
}
```

The manifest records requested behavior. The final report additionally records
resolved dependency versions, runtime and platform information, subject hashes
where available, counts derived from the run, and a digest of the manifest.

## Adapter contract

An adapter describes one semantic comparison domain. It owns:

- manifest validation specific to the domain;
- deterministic input generation or corpus decoding;
- subject invocation and result normalization;
- the comparison oracle and drift classification;
- optional candidate generation for shrinking; and
- domain-specific explanation codes.

An adapter does not own global severity labels, UI components, network access,
or report serialization. Those boundaries prevent a visually impressive adapter
from silently weakening the evidence model.

The initial adapter is `glob-route-drift`. Candidate later adapters include URL
normalization, IP address parsing, archive-path handling, and cross-runtime glob
matching. Each requires an explicit normalization contract before implementation.

## Artifact model

Every completed run can produce an evidence bundle containing:

```text
run/
  manifest.json
  report.json
  report.md
  replay.txt
  witnesses.ndjson
  regression/
```

`report.json` is the source for the Markdown report, both interface modes, and
test export. Counts or fixtures must not be copied into separate presenters.
Large witness streams use bounded NDJSON while the final report contains
aggregates, canonical witnesses, provenance, and content digests.

## Security and trust boundaries

The interface increases the attack surface even when it is local. Before custom
adapters or corpus import are considered stable, the implementation needs:

- strict loopback binding and request-origin validation;
- no ambient credential forwarding to adapter workers;
- subprocess isolation with explicit executable and argument arrays;
- no shell interpolation for manifests, paths, patterns, or witness strings;
- bounded CPU time, memory, output, witness count, and artifact size;
- canonical workspace containment for reads and writes;
- safe rendering of ANSI sequences, Markdown, HTML, regexes, and filenames;
- versioned schema validation on both sides of the worker boundary; and
- provenance that identifies unavailable, skipped, or failed comparators.

The first milestone may run only built-in adapters. Loading arbitrary local
plugins is a later capability with a separate threat model.

## Delivery stages

### Stage A — Contract and read-only viewer

- extract stable report and event types without changing harness behavior;
- render a saved glob report in both modes;
- show provenance, claims, limits, and replay command; and
- add snapshot and accessibility checks for deterministic views.

**Stop condition:** the CLI, Markdown renderer, and both interface modes agree on
all result fields for a checked-in deterministic fixture.

### Stage B — Local execution

- run the built-in glob adapter from the local service;
- stream progress and support cancellation;
- generate one evidence bundle from the final report; and
- verify loopback, token, validation, and resource-limit controls.

**Stop condition:** a clean checkout can launch the application, reproduce the
CLI result, and export a replayable bundle without network access.

### Stage C — Advanced workflow

- manifest editor with validation;
- option and dependency-version matrices;
- corpus import, run comparison, and regression-test export; and
- CI examples that execute saved manifests headlessly.

**Stop condition:** a maintainer can move from a new disagreement to a minimized,
reviewable regression test without manually copying a witness.

### Stage D — Adapter SDK and isolated workers

- document and version the adapter contract;
- run adapters in constrained workers;
- add one second domain to prove reuse; and
- evaluate Python, Go, or Rust workers only after transport and normalization
  semantics are tested.

**Stop condition:** two domains use the same runner, event, artifact, and UI
contracts without domain checks in shared code.

## First demo slice

The first UI demonstration should answer five questions in under one minute:

1. What two subjects are being compared?
2. What invariant should they satisfy in the modeled architecture?
3. Where did their decisions diverge?
4. How did the reducer obtain the small witness?
5. What exact command and versions reproduce the result?

The advanced view may expose every stage, but the Vibe Coder path should tell the
same story through a guided sequence. Neither mode should imply universal
equivalence or exploitability beyond the generated evidence.

## Ownership boundary for parallel work

This document is intentionally independent of the Stage 2 evidence-hardening
branch. Until that branch is merged, local-application work should avoid edits to:

- `harnesses/glob-middleware-drift.ts`;
- `lib/glob-shrink.ts`;
- `test/glob-middleware-drift.test.ts`;
- `test/glob-shrink.test.ts`;
- `README.md`, `package.json`, and `tsconfig.json`.

The first implementation branch should be cut from the post-Stage-2 `main`, then
begin with types and a read-only fixture viewer. Framework selection comes after
the event and report contracts are accepted.

## Decisions still required

- local browser application first, or an immediate desktop wrapper;
- retained-run storage policy and default location;
- whether dependency-version matrices use installed packages, isolated package
  workspaces, or containerized workers;
- initial accessibility and operating-system support targets; and
- the second adapter used to prove that the boundary is genuinely reusable.

The recommended defaults are a browser application, explicit user-selected
artifact directories, built-in adapters only, Node 20 and 22 support, and no
desktop wrapper until the complete glob workflow is useful headlessly.
