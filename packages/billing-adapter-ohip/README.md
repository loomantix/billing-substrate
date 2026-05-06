# `@loomantix/billing-adapter-ohip`

Ontario Ministry of Health MCEDT (Medical Claims Electronic Data Transfer) adapter for [billing-substrate](https://github.com/loomantix/billing-substrate). Reference implementation of the `JurisdictionAdapter` contract for the Ontario jurisdiction.

## Status

**v0.1.0 — early Phase 1.** Class shell + Ontario identifier validation. Record encoders, file orchestrator, and the full `ClaimRenderer` implementation land in subsequent issues against this repo (Phase 1 [2/6]–[5/6]).

API will break at any minor version bump until 1.0; pin exact minor version. See the [contract spec](https://github.com/loomantix/billing-substrate/blob/main/docs/architecture/contract-design.md) for the v1.0 stability commitment.

## What this adapter does (when complete)

- Renders a `ClaimBatch` (from `@loomantix/billing-adapter`) into the fixed-width 79-byte HEB / HEH / HET / HEE record-format file the ministry expects.
- Validates the batch against jurisdiction-specific structural rules (identifier formats, character class, mandatory fields) and aggregates every finding into a `ValidationReport` — never short-circuits on first error.
- Phase 2+ adds the MCEDT submission lifecycle (`submit` + `poll`) once a deployment passes ministry conformance testing.

## What this adapter does NOT do

Per the contract design rules, adapters validate **wire-format correctness only**. Domain rules (caps, stale-date, indirect/admin ratio enforcement, after-hours premium math) belong in the consuming product, not here.

## References

- **Contract spec** — [`docs/architecture/contract-design.md`](https://github.com/loomantix/billing-substrate/blob/main/docs/architecture/contract-design.md). Source of truth for the trait surface every adapter implements.
- **Format reference** — [`docs/architecture/ohip-record-format.md`](https://github.com/loomantix/billing-substrate/blob/main/docs/architecture/ohip-record-format.md) (HEB / HEH / HET / HEE record layout, Q310-Q313 specifics).
- **Authoring guide** — [`docs/architecture/authoring-an-adapter.md`](https://github.com/loomantix/billing-substrate/blob/main/docs/architecture/authoring-an-adapter.md) for adding a new jurisdiction.

## Usage (when complete)

```ts
import { OntarioMcedtAdapter } from '@loomantix/billing-adapter-ohip';
import type { ClaimBatch, SubmitterIdentity } from '@loomantix/billing-adapter';

const adapter = new OntarioMcedtAdapter();
const report = adapter.validate(batch);
if (report.violations.some((v) => v.severity === 'error')) {
  // surface every violation to the user
}
const rendered = await adapter.render(batch);
// rendered.bytes is the .ohip file ready for MCEDT upload
```

## License

Apache 2.0. Sign-off (DCO) required on contributions — see [`CONTRIBUTING.md`](../../CONTRIBUTING.md) in the substrate repo.
