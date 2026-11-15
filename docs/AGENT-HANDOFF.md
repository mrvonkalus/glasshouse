# Agent handoff protocol

GitHub is the source of truth. One agent owns a task branch at a time; agents do
not make concurrent edits on the same branch.

## Roles

- **Owner:** chooses product direction and approves public claims.
- **Research/scouting:** gathers sources, proposes hypotheses, and identifies
  edge cases without presenting unverified claims as results.
- **Implementation/integration:** audits evidence, writes maintainable code,
  runs the complete verification suite, and prepares the merge checkpoint.

## Handoff template

Every handoff should include:

1. **Goal** — the single outcome requested.
2. **Base** — repository, branch, and commit SHA.
3. **Observed evidence** — reproducible results, versions, and source links.
4. **Assumptions** — especially security or specification assumptions.
5. **Proposed experiment** — inputs, oracle, expected output, and stop condition.
6. **Files touched** — or the intended ownership boundary before coding.
7. **Verification** — commands run and exact pass/fail state.
8. **Claims and limits** — what the evidence supports and what it does not.
9. **Open questions** — decisions that require the owner or next agent.

## Merge gate

Before a branch is merged:

- Rebase or compare against current `origin/main`.
- Preserve unrelated work and inspect the complete diff.
- Run `npm run typecheck`, `npm test`, and `npm run verify`.
- Confirm generated counts come from the harness, not copied constants.
- Keep security impact conditional unless a real integration demonstrates it.
- Record the final commit and any follow-up work.
