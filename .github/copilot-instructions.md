# Copilot review instructions — billing-substrate

OSS substrate for healthcare claims submission and remittance reconciliation.
Multi-product, multi-jurisdiction. Apache 2.0 + DCO.

The contract package (`@loomantix/billing-adapter`) defines a stable
interface that any FHIR-based EMR can consume. Per-jurisdiction adapters
are independent packages contributed by the people who actually need
them. The first reference implementation is Ontario MCEDT (OHIP).

Canonical docs: `docs/architecture/contract-design.md` (formal contract spec), `CONTRIBUTING.md` (in-scope/out-of-scope rules). Path-specific rules live in `.github/instructions/*.instructions.md` and apply in addition to this file.

## Stack (do not suggest wrong-framework idioms)

| Layer     | Tech                                          |
| --------- | --------------------------------------------- |
| Language  | TypeScript 5.9 (strict, no `any`)             |
| Workspace | pnpm 10.29 with catalog mode                  |
| Runtime   | Node.js (LTS pinned via `.nvmrc`)             |
| Tests     | Vitest                                        |
| License   | Apache 2.0 + DCO sign-off                     |

Common mistakes to flag:

- Non-DCO-signed commits (CI rejects them, but flag in review).
- Importing consumer-product domain types into adapters.
- Adapter logic that short-circuits validation reports instead of
  aggregating every issue.
- Squash or rebase merge — repo policy is merge commits only.

## Non-negotiable code rules (flag as blocking)

- **Strict TypeScript everywhere. No `any`.** Require explicit return
  types on exported package APIs.
- **DCO sign-off required** on every commit (`git commit -s`). CI rejects
  commits without a `Signed-off-by:` trailer.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`). PR titles follow the same format.
- **Apache 2.0 license headers are not required** in source files —
  license coverage is at the repo level via `LICENSE` + `NOTICE`.

## Adapter contract rules (flag any violation as critical)

- **No domain types from any consumer leak into adapters.** No
  `Physician`, `TimeEntry`, `FhoGroup`, `Encounter` types or fields.
  Adapters operate purely on `claims-types` shapes; consumers translate.
- **No business logic in adapters.** Caps, stale-date checks, indirect
  / admin ratio enforcement, after-hours premium math — all of that
  belongs in the consuming product. Adapters validate wire-format
  correctness only.
- **Validation reports must be aggregated, not short-circuited.** A
  consumer should see every issue at once.
- **Fail-closed semantics for regulated wire formats.** Refuse to render
  a malformed claim rather than render one the payer will silently
  reject downstream.
- **One deployment cert per jurisdiction.** Cert handling is the
  deployment's responsibility, not the substrate package's. Adapter
  packages MUST NOT log, persist, or otherwise retain private keys.
- **Globalization is first-class.** New jurisdictions ship as new
  packages (`@<scope>/billing-adapter-<jurisdiction>`), never as
  branches in the core contract package.

## Review focus (priority order)

1. **Correctness against jurisdictional spec** — wire-format conformance,
   record-length, character set, date encoding, mandatory fields.
2. **Adapter independence** — does the change preserve the "no consumer
   domain types in adapters" invariant?
3. **Validation completeness** — does new adapter logic aggregate all
   issues, or does it short-circuit on the first?
4. **Security** — cert handling (no logging or persistence of private
   keys), input validation at the contract boundary, no SQL composition
   in any persistence layer.
5. **Convention adherence** — does new code follow patterns already in
   `packages/billing-adapter/src/`?
6. **Testing gaps** — new adapter logic without snapshot tests against
   fixture inputs is incomplete.
7. **Maintainability** — dead code, premature abstractions, defensive
   error handling for scenarios that can't happen.

## What NOT to suggest

- **Don't suggest comments that explain WHAT** (identifiers already do that) or reference the current PR / commit / caller. Comments are warranted only for non-obvious WHY.
- **Don't suggest backwards-compat shims, deprecation aliases, `_unused` renames, or `// removed X` comments.** Delete instead.
- **Don't suggest adding defensive validation at internal boundaries.** Validate only at system edges (controllers, user input, external APIs). Internal calls trust their types.
- **Don't suggest splitting a tight bug-fix PR** to add surrounding refactors or test coverage for unrelated code.
- **Don't suggest feature flags** for changes that can simply be made. No "toggle" unless explicitly requested.
- **Don't suggest new abstractions, helper functions, or refactors** beyond what the PR requires. Three similar lines is better than a premature abstraction.
- **Don't suggest squash or rebase merge** — repos use merge commits exclusively.

- **Don't suggest adding domain logic to adapters.** Caps, stale-date
  checks, business validation belong in consumer products, not in
  adapters.
- **Don't suggest coupling adapters to specific FHIR profiles** beyond
  what the contract requires.

---

_When in doubt, prefer citing a rule from `CLAUDE.md` or a path-specific file in `.github/instructions/` over inventing new guidance._

<!--
This file is generated from the upstream repo's
`.github/copilot-instructions.md.template` by the sync mechanism. Edits made
here in a consumer repo will be overwritten on the next sync.

To customize per-repo content, update `.platform-config.yml` in this repo with the
substitutions for: PROJECT_NAME, PROJECT_OVERVIEW, CANONICAL_DOCS, STACK_TABLE,
CODE_RULES, DOMAIN_RULES, REVIEW_FOCUS, WHAT_NOT_TO_SUGGEST_EXTRA.

To improve the shared skeleton (anything outside the placeholders), edit the
template upstream.
-->
