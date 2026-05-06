# `@loomantix/billing-adapter`

The contract package for [billing-substrate](https://github.com/loomantix/billing-substrate). Pure data types only at this stage.

## Status

**v0.x — contract surface defined per the [contract spec](https://github.com/loomantix/billing-substrate/blob/main/docs/architecture/contract-design.md) (initial design merged 2026-05-02).** API may break at any minor version bump until 1.0; pin exact minor version. 1.0 ships when the OHIP reference implementation reaches Phase 2 *and* at least one community-contributed adapter exists.

## What's in here

**Contract:**
- `ClaimRenderer` — Phase 1 capability (validate + render). Every adapter implements this.
- `ClaimSubmitter extends ClaimRenderer` — Phase 2+ capability (submit + poll).
- `JurisdictionAdapter` — union of the two tiers.
- `canSubmit(adapter)` — type guard for capability narrowing.

**Data shapes:**
- `ClaimBatch`, `ClaimItem`, `ServicePeriod`, `PatientReference` — input shape consumers translate into.
- `SubmitterIdentity` — submitting entity with jurisdiction-specific identifiers.
- `SubmitterCredentials` — opaque per-jurisdiction credential bag for submit/poll. Adapters MUST NOT persist.
- `Jurisdiction` — branded string type.
- `RenderedClaim` — output of `render` (wire-format bytes + content hash).

**Submission lifecycle:**
- `SubmitReceipt`, `PollOutcome`, `AdjudicationResult`, `LineResult`, `LineOutcome`.

**Errors:**
- `AdapterError` — discriminated union with seven exhaustive variants (`validation`, `transport`, `auth`, `rejected`, `rate-limited`, `timeout`, `not-supported`).

**Pre-flight validation:**
- `ValidationReport`, `ValidationViolation`, `Severity`.

## Usage

```ts
import type { ClaimBatch, ClaimItem, SubmitterIdentity } from '@loomantix/billing-adapter';

// Translate your domain model into a ClaimBatch shape.
const batch: ClaimBatch = {
  submitterId: 'group-uuid-here',
  servicePeriod: { start: '2026-04-19', end: '2026-05-18' },
  items: yourTimeEntries.map(toClaimItem),
};
```

The adapter that consumes a `ClaimBatch` is published as a separate package per jurisdiction (e.g. [`@loomantix/billing-adapter-ohip`](../billing-adapter-ohip) in this repo).

## License

Apache 2.0. Sign-off (DCO) required on contributions — see `CONTRIBUTING.md` in the substrate repo.
