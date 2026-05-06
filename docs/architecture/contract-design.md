# Contract design — `@loomantix/billing-adapter`

This document is the formal spec of the adapter contract every jurisdictional adapter implements. It is the contributor-facing specification.

## Tier model

Two-tier composed-trait pattern, narrowed via property test:

```typescript
ClaimRenderer    // Phase 1 capability — every adapter ships this tier
ClaimSubmitter   // Phase 2+ capability — extends ClaimRenderer, adds submit + poll

type JurisdictionAdapter = ClaimRenderer | ClaimSubmitter;
```

**Why two tiers:** every adapter's first useful version is render-only — a deployment that emits a wire-format file consumers hand-deliver to the jurisdiction (e.g. a `.ohip` file uploaded through a billing agent's existing channel). Live submission requires jurisdictional conformance testing per deployment, which is a multi-week external dependency. The two-tier model lets a Phase 1 adapter ship before conformance lands.

**Capability narrowing:**

```typescript
import { canSubmit, type ClaimRenderer } from '@loomantix/billing-adapter';

function send(adapter: ClaimRenderer, /* ... */) {
  if (canSubmit(adapter)) {
    // adapter is ClaimSubmitter here — submit + poll callable
    return adapter.submit(/* ... */);
  } else {
    // render-only — call render and hand bytes to the user for manual upload
    return adapter.render(/* ... */);
  }
}
```

## Methods

### `validate(batch: ClaimBatch): ValidationReport`

Pre-flight validation. Returns a `ValidationReport` aggregating *every* finding. Adapters MUST NOT short-circuit on first error.

A report is **passable** when no `severity: 'error'` violations are present. `'warning'` violations are informational and don't block render.

Each `ValidationViolation` carries:
- `severity: 'error' | 'warning'`
- `code: string` — stable machine-readable code (e.g. `'missing-group-number'`); consumers pattern-match on this
- `message: string` — human-readable description for surface display
- `path?: string` — optional pointer into the batch (e.g. `'items[3].feeCode'`)

### `render(batch: ClaimBatch): Promise<RenderedClaim>`

Render the batch into the jurisdiction's wire format. **Pure** — no side effects, no I/O, no logging. Same input MUST produce same bytes (deterministic). Adapters that need network resources (e.g. for code-set lookups) cache them at construction.

Returns a `RenderedClaim`:
- `bytes: Uint8Array` — wire-format bytes ready for transmission
- `byteCount: number`
- `contentHashSha256Hex: string` — SHA-256 hex digest of `bytes` (verifiable by callers)
- `jurisdiction: Jurisdiction`

MAY throw `AdapterErrorException` (kind `validation`) if validation passed at validate-time but the renderer detects a constraint violation downstream (e.g. an encoding rule the validator didn't catch). Adapters always throw the `AdapterErrorException` wrapper, never the bare `AdapterError` payload — see [Error model](#error-model) below.

### `submit(rendered, submitter, credentials): Promise<SubmitReceipt>` *(Phase 2+)*

Upload + submit the rendered batch to the jurisdiction's adjudication system. Returns a `SubmitReceipt` the consumer persists.

**Idempotent on the receipt level.** Re-submitting the same `rendered` MUST produce a receipt referencing the same upstream resource (or the same receipt) — never a duplicate claim downstream. Adapters achieve this via jurisdiction-supported idempotency keys, content-hash-derived submission IDs, or pre-submit deduplication queries — whichever the jurisdiction provides.

Credentials are passed per-call; adapters MUST NOT persist `SubmitterCredentials.material` to disk, log, or any non-volatile store.

### `poll(receipt, credentials): Promise<PollOutcome>` *(Phase 2+)*

Poll the jurisdiction for adjudication status. Returns:
- `{ kind: 'pending' }` — jurisdiction has not finished adjudicating
- `{ kind: 'resolved', result: AdjudicationResult }` — outcome available

Callers manage their own polling cadence and backoff. Adapters MUST NOT block-poll internally; each `poll` call performs at most one round-trip to the jurisdiction.

## Contract obligations (binding on every adapter)

1. **`validate` aggregates every finding.** No first-error short-circuit. Consumers must be able to surface every issue at once.
2. **`render` is deterministic.** Identical `ClaimBatch` produces identical `RenderedClaim.bytes`. Test this — it's load-bearing for audit and content-hash dedupe.
3. **`RenderedClaim.contentHashSha256Hex` is the SHA-256 hex digest of `bytes`.** Callers verify on receipt.
4. **`submit` is idempotent against the same `rendered` artifact.** Same content → same upstream resource. Never a duplicate claim downstream.
5. **No credential persistence.** Adapter does not write `SubmitterCredentials.material` to disk, log, or any non-volatile store. Material is held only as long as needed to complete the call.
6. **Stateless across invocations.** All state required for `poll` lives in the persisted `SubmitReceipt`. Adapters are cheap to construct and discard.

## Error model

Adapter methods reject by throwing **`AdapterErrorException`** — an `Error` subclass that wraps a discriminated `AdapterError` payload. Adapters MUST throw the wrapper, never the bare payload: callers rely on `instanceof Error`, `Error.stack`, and structured-logger fingerprinting (pino, Sentry, OpenTelemetry exporters all special-case `Error` instances).

```typescript
import {
  AdapterErrorException,
  type AdapterError,
  type ClaimRenderer,
} from '@loomantix/billing-adapter';

try {
  await adapter.render(batch);
} catch (e) {
  if (e instanceof AdapterErrorException) {
    switch (e.error.kind) {
      case 'validation':
        return surfaceReport(e.error.report);
      case 'transport':
        return retryWithBackoff();
      // ...
    }
  }
  throw e; // not from this adapter
}
```

The wrapper's `.message` is uniformly formatted as `<kind>: <description>` (e.g. `"validation: 3 blocking violations"`, `"rejected: V01: bad payload"`, `"transport: connection refused"`). The variant-specific description comes from the exported `describeAdapterError` helper; the constructor adds the kind prefix so logs are grep-uniform across variants. Consumers that want the structured payload narrow on `e.error.kind`.

The discriminated `AdapterError` payload variants:

| `kind` | Meaning | Caller behavior |
|---|---|---|
| `validation` | Validation failed | Surface report; do not retry |
| `transport` | Network/IO failure | Retry with backoff |
| `auth` | Credentials rejected by jurisdiction | Re-fetch credentials, alert ops |
| `rejected` | Jurisdiction rejected the upload itself (file-level, not per-line) | Surface code+message; do not retry without modification |
| `rate-limited` | Jurisdiction throttled the request | Honor `retryAfterMs` if present, else exponential backoff |
| `timeout` | Adapter-level deadline exceeded | Retry with backoff or surface to caller |
| `not-supported` | Adapter doesn't implement this operation | Programming error; surface and halt |

Adapters MUST exhaust these variants. Collapsing distinct failure modes into `transport` or any catch-all is a contract violation.

**PHI scrubbing:** `AdapterError.message` and `ValidationViolation.message` cross the public adapter boundary. Adapters MUST sanitize patient identifiers (HIN, DoB, names) out of these strings before throwing — `describeAdapterError` formats; it does not sanitize. See `describeEmitError` in `@loomantix/billing-adapter-ohip` for the reference scrubbing pattern.

## Versioning

The contract package follows semver:

- **Pre-1.0 (current):** minor bumps may include breaking type-shape changes. Pin exact minor version in adapter `peerDependencies`. We aim to reach 1.0 once the OHIP reference implementation ships Phase 2 and at least one community-contributed adapter exists — that's the evidence the shape survived second-implementation contact.
- **Post-1.0:** breaking changes require a major version bump and a 6-month deprecation cycle. Old shapes remain importable from a `legacy` subpath through one major.
- **Additions are minor bumps.** New optional fields, new variants on union types, new methods on `ClaimSubmitter`-and-beyond tiers.
- **Adapters version independently.** Each adapter package declares contract compat via `peerDependencies: { "@loomantix/billing-adapter": "^x.y" }`.

## Authoring a new adapter

The substrate's design goal is that a third-party developer with a country's wire-format spec can write a new adapter package without our involvement. The minimum viable shape:

```typescript
// packages/billing-adapter-<jurisdiction>/src/index.ts
import type {
  ClaimBatch,
  ClaimRenderer,
  Jurisdiction,
  RenderedClaim,
  ValidationReport,
} from '@loomantix/billing-adapter';

export class BcMspAdapter implements ClaimRenderer {
  readonly jurisdiction: Jurisdiction = 'bc-msp';

  validate(batch: ClaimBatch): ValidationReport {
    // Aggregate every finding. Return all of them.
  }

  async render(batch: ClaimBatch): Promise<RenderedClaim> {
    // Pure: same input → same bytes. Compute SHA-256 of bytes.
  }
}
```

Phase 2+ extends `ClaimSubmitter` and implements `submit` + `poll`. Publish to npm under your own scope (`@<your-org>/billing-adapter-<jurisdiction>` is the convention; you don't need to publish under `@loomantix`).

For contribution-back-to-this-repo (becoming `@loomantix/billing-adapter-<jurisdiction>`), see [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## What's NOT in this contract

By design:

- **FHIR resource shapes.** `ClaimBatch` is a wire-format-neutral primitive, not a FHIR `Claim`. Consumers using FHIR substrates (Medplum, etc.) translate `Claim` → `ClaimBatch` at their boundary. This is deliberate — Ontario MCEDT's HEH/HET fixed-width records have no clean FHIR mapping for non-patient-linked claims.
- **Domain rules.** Caps, stale-date, business validation belong to consumer products, not adapters. Adapters validate wire-format correctness only.
- **Coding-system translation.** Each adapter accepts the codes its jurisdiction expects. CPT ↔ ICD ↔ SNOMED mapping is Layer 2 and out of scope for this contract.
- **Eligibility queries** (real-time "is this patient covered for this code right now?"). Layer 4. Future ADR.
- **Compliance wrapper** (per-jurisdiction audit/retention/consent). Layer 5. Lives at deployment.

## Reference impl

`@loomantix/billing-adapter-ohip` is the Loomantix-built reference implementation for Ontario MCEDT (Q310-Q313 hourly fee codes; encounter codes follow). Studying it is the fastest way to understand what a complete adapter looks like.

For the contributor walkthrough — package layout, the minimum `ClaimRenderer` skeleton, all six contract obligations with concrete OHIP file references, and the Phase 2+ `ClaimSubmitter` extension shape — see [`authoring-an-adapter.md`](./authoring-an-adapter.md).

## Cross-references

- [`packages/billing-adapter/src/index.ts`](../../packages/billing-adapter/src/index.ts) — the source of truth for type signatures
- [`authoring-an-adapter.md`](./authoring-an-adapter.md) — contributor walkthrough
- [`ohip-record-format.md`](./ohip-record-format.md) — Ontario MCEDT byte-layout reference
