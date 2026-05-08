# Agent-loop instructions

You're working autonomously on a single GitHub issue in this repository. Read this file fully, then read `gh issue view <N>` for your assigned issue. Work the issue, open a PR, and exit.

> **Customize this file before running `/agent-loop`.** It was created from a starter template on first sync from upstream. Sections marked `TODO:` need values for your repo. The file lives at the repo root and is _not_ overwritten by subsequent syncs (its sync target uses `create_if_missing: true`).

## Repo overview

OSS multi-jurisdiction healthcare claims-adapter substrate. TypeScript pnpm monorepo shipping `@loomantix/billing-adapter` (the contract package — `ClaimBatch`, `ClaimRenderer`, `ClaimSubmitter`, `AdapterError`) and `@loomantix/billing-adapter-ohip` (the Ontario MCEDT reference implementation). Consumed by FHIR-based EMRs that need to bill against a jurisdictional payer; per-country adapters land as independent packages contributed by the people who actually need them.

## Build / test

```bash
# install deps (frozen lockfile, matches CI)
pnpm install --frozen-lockfile

# type-check all packages
pnpm -r --if-present run typecheck

# unit + integration tests (vitest)
pnpm -r --if-present run test

# build all packages (tsc per package)
pnpm -r --if-present run build
```

CI runs Type-check, Test, and Build as required checks on PRs targeting `main`. There is no lint script in this repo — type-check is the static-analysis gate.

## Commit + PR rules

- **Conventional commits** required: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`. PR titles follow the same format.
- **DCO sign-off** enforced. Every commit must carry a `Signed-off-by:` trailer (`git commit -s`). The DCO check runs on every PR and rejects unsigned commits.
- **Signed commits**: recent commits on `main` are GPG-signed in practice. Don't bypass with `--no-gpg-sign` or `-c commit.gpgsign=false`.
- **Annotated tags only** for releases (`git tag -a -m "..."`). Existing tags (`v0.1.1`, `v0.2.0`) are annotated; the publish workflow triggers on `v*` push.
- **PR base branch**: `main`. Branch protection is on with strict mode (must be up-to-date) and no admin bypass; direct push is blocked.
- **Merge commits only** — repo policy is no squash/rebase merges.
- **Heredocs in `gh` commands cause permission prompts** — write multiline bodies to a temp file first, then `gh pr create --body-file <path>`.

## What NOT to edit

This repo consumes synced files from `loomantix/claude-platform` via `.github/workflows/sync-from-upstream.yml`. The files listed below are overwritten on every sync — local edits will be reverted. The canonical list is the upstream's `scripts/sync-targets.yml`; this repo's `.platform-config.yml` declares an empty `skip_targets:`, so every non-`delete` destination in the manifest applies here.

Synced surfaces (do **not** edit in this repo):

- `.claude/skills/issues/SKILL.md` and `scripts/ready.py`, `scripts/link.py`
- `.claude/skills/refactorpass/SKILL.md`
- `.claude/skills/grill/SKILL.md`
- `.claude/skills/deepgrill/SKILL.md`
- `.claude/skills/reviewit/SKILL.md`
- `.claude/skills/copilot-review/SKILL.md`
- `.claude/skills/feature-dev/SKILL.md`
- `.claude/skills/agent-loop/SKILL.md` and `scripts/agent-loop.sh`
- `.claude/agents/code-explorer.md`, `code-architect.md`, `code-reviewer.md`
- `.claude/REVIEW_WORKFLOW.md`
- `.claude/settings.json`
- `.github/copilot-instructions.md` (generated from the upstream template using values in `.platform-config.yml` — change the substitution values, not the generated file)

This file (`agent-loop-instructions.md`) is bootstrapped via `create_if_missing: true` and is **not** overwritten by subsequent syncs — local customizations here are safe.

If your issue requires changing any of the synced surfaces above, **stop and post a comment on the issue** explaining the change belongs upstream. Don't edit the consumer copy — it'll be reverted on the next sync.

## Filesystem hygiene

- Use repo-scoped `/tmp` paths: `/tmp/<repo-name>/...` rather than bare `/tmp/foo` to avoid collisions across parallel sessions on the same machine.

## Out-of-scope guardrails

If you discover any of these mid-issue, **stop, comment on the issue with what you found, and exit without a PR**:

- The issue requires touching another repository (cross-repo coordination).
- The issue has open policy questions — re-read the body; if it asks "should we A or B?" or "decision needed," that's a human call.
- The issue requires deleting org-level secrets, modifying branch protection, or installing GitHub Apps — these have organization-wide blast radius and need human verification.
- Acceptance criteria can't be satisfied without changing the synced surfaces listed above.

## Pre-push review (if these skills are available)

Before pushing your PR, run the lean review chain (skip on docs/config-only changes):

1. `/refactorpass` — single `/simplify` pass.
2. `/grill` — runs `code-reviewer` and `silent-failure-hunter` agents on the diff.

## PR shape

```markdown
## Summary

<1–3 bullets, what changed and why>

## Test plan

- [ ] <build command>
- [ ] <test command>
- [ ] <issue-specific verification>

Closes #<N>
```

After opening the PR, run `/reviewit <pr-number>` to fire AI reviews and address findings. The lean default caps at 2 iterations.
