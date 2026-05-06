# Contributing to billing-substrate

Thank you for considering a contribution. This substrate is published as a demonstration that others can fork and extend; the bar on contract clarity and contributor friction is therefore deliberately high. Read this whole file before opening a PR — the DCO and project-shape rules below are non-negotiable.

## License

This project is licensed under [Apache 2.0](./LICENSE). All contributions are licensed under the same terms.

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/) instead of a Contributor License Agreement. By signing off on your commits, you certify the contribution is your own work or you have the right to submit it under the project's open-source license.

**Every commit must be signed off**, with the trailer:

```
Signed-off-by: Your Real Name <your.email@example.com>
```

Use `git commit -s` to add the trailer automatically. CI rejects PRs with unsigned commits.

The full DCO text is at https://developercertificate.org/. By signing off, you are agreeing to it.

## What we accept

**In scope:**
- New jurisdictional adapter packages (`@<your-org>/billing-adapter-<jurisdiction>` is fine; you don't need to publish under `@loomantix`).
- Improvements to the contract package (`@loomantix/billing-adapter`) that strengthen its expressiveness without breaking existing adapters.
- Documentation, examples, contract-shape clarifications.
- CI, build, type-system, or testing improvements.
- Bug fixes in any package.

**Out of scope (please open an issue first to discuss):**
- New layers in the architecture beyond the [5-layer model](./README.md#layering).
- Domain logic (caps, stale-date rules, business validation) inside adapters — these belong in consumer products.
- Coupling adapters to specific FHIR profiles. The contract is FHIR-substrate-agnostic.
- Authentication/secrets handling inside adapter packages — that's a deployment concern.

## Adding a new jurisdictional adapter

The adapter contract is specified in [`docs/architecture/contract-design.md`](./docs/architecture/contract-design.md).

For a concrete walkthrough — package layout, the minimum `ClaimRenderer` skeleton, all six contract obligations with `@loomantix/billing-adapter-ohip` examples, and the Phase 2+ `ClaimSubmitter` extension shape — read [**`docs/architecture/authoring-an-adapter.md`**](./docs/architecture/authoring-an-adapter.md). It's the fastest path from "I want to add my jurisdiction" to a working skeleton.

You can publish a new adapter under your own npm scope (`@<your-org>/billing-adapter-<jurisdiction>`) without coordinating with us — the contract is open. To contribute one back to this repo as `@loomantix/billing-adapter-<jurisdiction>`, please open an issue first describing:

1. Jurisdiction (country, payer, regulatory framework)
2. Wire format (technical specification reference)
3. Submission transport (SOAP, REST, EDI, batch FTP, etc.)
4. Conformance/certification regime (if any)
5. Who you are and why you're motivated to maintain this adapter

We'll work with you on contract fit and publishing logistics before you start implementation.

## Workflow

1. **Open an issue** describing the change. For non-trivial changes, get rough alignment before opening a PR.
2. **Fork the repo and create a feature branch**. Branch names: `feat/<short-description>`, `fix/<short-description>`, `docs/<short-description>`.
3. **Make your changes**, with `git commit -s` (DCO sign-off) on every commit.
4. **Run CI locally**:
   ```bash
   pnpm install
   pnpm typecheck
   pnpm lint
   pnpm test
   ```
5. **Open a PR** against `main`. CI must pass. We aim to review within a week.

## Code review expectations

- Adapters that touch regulated wire formats are reviewed for fail-closed semantics. We'd rather your code refuse to render a malformed claim than render one that gets silently rejected by the payer downstream.
- Validation reports must be aggregated, not short-circuit. A consumer should see every issue at once.
- No `any`. Strict TypeScript everywhere.
- Tests are non-negotiable for adapter logic. Snapshot tests against fixture inputs are the simplest pattern.

## Code of Conduct

By participating you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

If you discover a security issue, do **not** open a public issue. See [`SECURITY.md`](./SECURITY.md) for the responsible-disclosure process.

## Questions

For substrate-shape questions, open an issue with the `question` label.
