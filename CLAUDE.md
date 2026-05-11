# billing-substrate — Claude project guide

OSS multi-jurisdiction healthcare claims-adapter substrate. Apache 2.0 + DCO. See [README.md](README.md) for what ships here, [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow, and [docs/architecture/contract-design.md](docs/architecture/contract-design.md) for the formal contract spec.

## Public-Repo Policy

This repo is public. Keep repository content suitable for public readers:

- Do not reference non-public repositories, systems, incidents, or trackers by name.
- Do not document deployment-specific wiring, app slugs, secret names, or escalation paths beyond the public templates.
- Keep compliance and security rationale generic; do not include organization-specific evidence or customer-specific details.
- Put project-specific consumer details in that consumer's own repository, not here.

If work needs non-public context, discuss that context outside this public repository and keep any public issue or PR focused on the reusable change.

## Conventions

- **DCO sign-off** on every commit (`git commit -s`); CI rejects unsigned commits.
- **Conventional commits** for messages and PR titles (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
- **Annotated tags only** for releases (`git tag -a -m "..."`); the publish workflow triggers on `v*` push.
- **Branch protection on `main`**: PR + required CI checks (DCO sign-off check, Type-check, Test, Build), strict mode (must be up-to-date), no admin bypass; direct push blocked.
- **Merge commits only** (not squash/rebase).

## Adapter contract (non-negotiable)

Every jurisdictional adapter MUST satisfy:

- **No consumer domain types in adapters.** Adapters operate on `ClaimBatch` shapes only — no `Physician`, `TimeEntry`, `Encounter`, etc.
- **No business logic in adapters.** Caps, stale-date, eligibility — all consumer-side. Adapters validate wire-format correctness only.
- **`validate` aggregates every finding.** Never short-circuit on first error.
- **`render` is deterministic.** Same input → byte-identical output.
- **`submit` is idempotent.** Same `RenderedClaim` → same upstream resource.
- **No credential persistence.** `SubmitterCredentials.material` never written to disk, log, or any non-volatile store.
- **Stateless across invocations.** All state required for `poll` lives in the persisted `SubmitReceipt`.

Full spec at [docs/architecture/contract-design.md](docs/architecture/contract-design.md).

## Cross-references

- [README.md](README.md) — what this is, 5-layer billing-abstraction model, hard rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — DCO, scope, workflow
- [SECURITY.md](SECURITY.md) — responsible disclosure
- [docs/architecture/contract-design.md](docs/architecture/contract-design.md) — formal contract spec
- [docs/architecture/authoring-an-adapter.md](docs/architecture/authoring-an-adapter.md) — contributor walkthrough for adding a new jurisdiction
- [docs/architecture/ohip-record-format.md](docs/architecture/ohip-record-format.md) — Ontario MCEDT byte-layout reference
