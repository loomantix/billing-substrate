# billing-substrate

OSS substrate for healthcare claims submission and remittance reconciliation. Multi-product, multi-jurisdiction. Apache 2.0 + DCO.

> **Status:** Phase 0 + early Phase 1 scaffolding. Ontario MCEDT is the first jurisdiction. See [`docs/architecture/contract-design.md`](./docs/architecture/contract-design.md) for the formal contract spec.

## What this is

Healthcare claims submission has a long tail of jurisdiction-specific wire formats, regulatory contexts, conformance regimes, and identity assurance models. Every vertical-EMR product that wants to bill in a new region either rebuilds the whole pipeline or buys a per-country billing vendor. Both are expensive; the latter compresses margins to the point where vertical-EMR products become non-viable outside the dominant US billing market.

This substrate is an attempt to break that pattern: a contract-first architecture where per-country adapters are independent packages contributed by the people who actually need them, against a stable contract that any FHIR-based EMR can consume.

The first reference implementation is `@loomantix/billing-adapter-ohip` (Ontario MCEDT). Subsequent adapters land as community contributions or per-country engagements: BC MSP, Alberta AHC, US X12 837, German KBV, French FSE, South African medical schemes, and so on.

## Demonstration intent

This repo is published as a **demonstration that others can fork**. Not just the code — the architectural pattern. Vertical-EMR projects building anywhere in the world should be able to look at this substrate, understand the contract shape, and either:

- Adopt the existing contract and contribute their country's adapter back, or
- Fork the substrate to suit their own architectural preferences while reusing the conceptual layering.

The bar on documentation, contract clarity, and contributor onboarding is therefore high. If the patterns here aren't legible to a fresh outside contributor, that's a substrate bug.

## Architecture

```
billing-substrate/
├── packages/
│   ├── billing-adapter/                # @loomantix/billing-adapter — contract package
│   │   └── src/                        # ClaimBatch, ClaimRenderer, ClaimSubmitter, AdapterError, …
│   └── billing-adapter-ohip/           # @loomantix/billing-adapter-ohip — Ontario reference impl
└── (future) deployment/                # Loomantix's commercial deployment shape (separate ADR)
```

### Layering

The substrate sits in a 5-layer billing-abstraction model:

1. **FHIR substrate** — `Claim`, `Coverage`, `ChargeItem`, `Account`, `ExplanationOfBenefit`, `ClaimResponse`, `Invoice` resources via Medplum (or any FHIR R4 store).
2. **Coding-system abstraction** — pluggable code-set packages (`@loomantix/codeset-ohip`, future `@loomantix/codeset-cpt-us`, etc.).
3. **Submission adapter contract** — the `JurisdictionAdapter` interface and per-country implementations. **This substrate.**
4. **Eligibility + payment-posting + denial loop** — standardized contracts for real-time eligibility queries and denial-code-to-action mapping.
5. **Compliance wrapper** — per-jurisdiction audit/retention/consent (PHIPA, HIPAA, GDPR, POPIA, etc.) — typically deployed alongside the substrate, not embedded in it.

Layer 3 is what `@loomantix/billing-adapter` formalizes. Layer 2 (coding systems) and Layer 4 (eligibility) get their own contract packages once their first reference implementation surfaces a stable shape.

### Hard rules for adapters

- **No domain types from any consumer leak into adapters.** No `Physician`, `TimeEntry`, `FhoGroup`, `Encounter` — adapters operate purely on `claims-types` shapes. Consumers translate.
- **No domain rules in adapters.** Caps, stale-date, business validation belong to consumer products. Adapters validate wire-format correctness only.
- **One deployment cert per jurisdiction.** A deployment of the substrate (Loomantix's, or anyone's) holds one signing cert per jurisdiction whose CA accepts it. Cert handling is the deployment's responsibility, not the substrate package's.
- **Globalization is first-class.** New jurisdictions ship as new packages, not branches in core.
- **Adapters do not assume a deployment shape.** They expose pure functions and a trait. Whether a deployment runs them as a service, embeds them in a backend, or runs them as a serverless function is the deployment's choice.

## Getting started

To work on the substrate locally:

```bash
pnpm install
pnpm -r build
pnpm -r test
```

Both packages (`@loomantix/billing-adapter` contract + `@loomantix/billing-adapter-ohip` reference adapter) are at v0.1.0. The OHIP adapter is in early Phase 1 — class shell + Ontario identifier validation; record encoders, file orchestrator, and the full `ClaimRenderer` implementation land in subsequent PRs against this repo.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). The short version: Apache 2.0 license, DCO sign-off (`git commit -s`) required on every commit, all PRs go through CI (lint + type-check + test) before review.

## License

Apache 2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

## References

- [`docs/architecture/contract-design.md`](./docs/architecture/contract-design.md) — formal contract spec
- [`docs/architecture/authoring-an-adapter.md`](./docs/architecture/authoring-an-adapter.md) — contributor walkthrough for adding a new jurisdiction
- [`docs/architecture/ohip-record-format.md`](./docs/architecture/ohip-record-format.md) — Ontario MCEDT byte-layout reference
