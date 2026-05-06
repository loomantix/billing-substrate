# Authoring a jurisdictional adapter

This is the contributor-facing walkthrough for adding a new jurisdiction to the substrate. It complements [`contract-design.md`](./contract-design.md) (the formal spec) by showing how the contract is satisfied in practice, using `@loomantix/billing-adapter-ohip` (Ontario MCEDT) as the canonical reference implementation.

You can publish a new adapter under your own npm scope (`@<your-org>/billing-adapter-<jurisdiction>`) without coordinating with us — the contract is open. Only contributing back to this repo as `@loomantix/billing-adapter-<jurisdiction>` requires upfront alignment; see [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Audience

You are an EMR/billing engineer or community contributor who wants to:

- Render claim batches into your jurisdiction's wire format.
- Optionally (Phase 2+) submit them to the jurisdiction's adjudication system and poll for outcomes.
- Either ship privately under your own org, or upstream into Loomantix's repo.

You should already be familiar with:

- TypeScript (strict mode; this codebase uses `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`).
- The contract types in `@loomantix/billing-adapter` — read [`contract-design.md`](./contract-design.md) first.
- Your jurisdiction's wire-format technical specification.

## At a glance

```text
packages/billing-adapter-<jurisdiction>/
├── package.json              # peerDependencies on @loomantix/billing-adapter
├── tsconfig.json             # extends ../../tsconfig.base.json
├── README.md
└── src/
    ├── index.ts              # exports the Adapter class implementing ClaimRenderer
    ├── types.ts              # jurisdiction-specific identifier shapes
    ├── records/              # wire-format record encoders (one file per record type)
    ├── emit/                 # file-level orchestrator (composes encoders)
    └── validate/             # pre-flight validator (aggregates every finding)
```

The OHIP package follows this exact layout. You can use it as a starting template:

- [`packages/billing-adapter-ohip/package.json`](../../packages/billing-adapter-ohip/package.json) — peer dep on `^0.0.1` of the contract package, dev deps under pnpm `catalog:`, scripts for `build`/`test`/`typecheck`.
- [`packages/billing-adapter-ohip/tsconfig.json`](../../packages/billing-adapter-ohip/tsconfig.json) — minimal extends-base layout.

## Phase 1: implement `ClaimRenderer`

Every adapter ships its first version as `ClaimRenderer` (validate + render only). This tier is sufficient for file-emitter use cases — your consumer renders bytes and hands them to a billing agent who has the jurisdiction's submission channel set up through some other means.

Minimal skeleton:

```typescript
import {
  AdapterErrorException,
  type ClaimBatch,
  type ClaimRenderer,
  type Jurisdiction,
  type RenderedClaim,
  type ValidationReport,
} from '@loomantix/billing-adapter';

export class MyJurisdictionAdapter implements ClaimRenderer {
  readonly jurisdiction: Jurisdiction = 'my-jurisdiction';

  constructor(private readonly config: MyAdapterConfig) {
    // Static config: identifiers, spec version, deployment-level settings.
    // Adapter is stateless across invocations — see obligation 6.
  }

  validate(batch: ClaimBatch): ValidationReport {
    // Aggregate every wire-format-level finding. No first-error short-circuit.
    // See obligation 1.
  }

  async render(batch: ClaimBatch): Promise<RenderedClaim> {
    const report = this.validate(batch);
    if (report.violations.some((v) => v.severity !== 'warning')) {
      throw new AdapterErrorException({ kind: 'validation', report });
    }
    // Emit deterministic bytes. Compute SHA-256 hash. See obligations 2 + 3.
  }
}
```

The OHIP equivalent lives at [`packages/billing-adapter-ohip/src/index.ts`](../../packages/billing-adapter-ohip/src/index.ts). Everything below that line walks through the six contract obligations using OHIP code as the example.

## The six contract obligations

The contract binds every adapter to six obligations. Each is non-negotiable; reviewers will check all six on contribution-back PRs.

### Obligation 1 — `validate` aggregates every finding

A `ValidationReport` returned from `validate` MUST contain every violation, not just the first. Consumers surface all of them at once so users can fix everything in a single editing pass.

**OHIP example:** [`packages/billing-adapter-ohip/src/validate/validate-batch.ts`](../../packages/billing-adapter-ohip/src/validate/validate-batch.ts) builds a `violations: ValidationViolation[]` array and pushes into it from every check. Helpers like `pushError` and `pushWarning` never throw, never return early. The aggregation test pins this — a batch with 10 different problems produces 10 findings in one pass.

**Pattern to follow:** pass an accumulator array down through every per-rule helper. Push, don't return-early. Test aggregation explicitly with a deliberately-bad input.

### Obligation 2 — `render` is deterministic

Identical `ClaimBatch` MUST produce identical `RenderedClaim.bytes`. Determinism is load-bearing for content-hash dedupe at the deployment layer, snapshot tests, and audit reproducibility.

**OHIP example:** [`packages/billing-adapter-ohip/src/emit/emit-claim-file.ts`](../../packages/billing-adapter-ohip/src/emit/emit-claim-file.ts) sorts items into a *total* order over every visible field (date, fee code, units, fee, patient HIN/DoB/version, diagnostic, location) before grouping. Two callers who construct the same logical batch in different order produce the same bytes.

**Pattern to follow:**
- Establish a total order over claim items at the start of `render`. A partial sort + JS `Array.sort` stability would let caller insertion order leak into the output and the SHA-256 hash.
- Never iterate `Map` / `Set` / `Object.keys` without sorting first.
- Never call `Date.now()` or anything random inside `render`.
- Test by rendering the same logical batch in multiple input orderings and asserting byte-equal output + matching content hash.

### Obligation 3 — `RenderedClaim.contentHashSha256Hex` is SHA-256 of `bytes`

Compute the hash via `crypto.createHash('sha256').update(bytes).digest('hex')` *after* the byte array is finalized. Never compute from intermediate state. Callers verify on receipt; deployments use the hash for dedupe.

**OHIP example:** [`packages/billing-adapter-ohip/src/emit/emit-claim-file.ts`](../../packages/billing-adapter-ohip/src/emit/emit-claim-file.ts) computes the hash as the very last step before returning. The unit tests independently recompute `createHash('sha256').update(rendered.bytes).digest('hex')` and assert equality.

**Pattern to follow:** treat the hash as derived data. Always compute it after the bytes are immutable. Test with an independent recomputation, not a hardcoded hex.

### Obligation 4 — `submit` is idempotent against the same `rendered` artifact

(Phase 2+ only — does not apply if your adapter is render-only at this version.)

Re-submitting the same `RenderedClaim` MUST produce a receipt referencing the same upstream resource (or the same receipt). Never a duplicate claim downstream. Duplicate claims cause real money problems (double-payment, audit flags).

**Mechanism options** (use whichever your jurisdiction supports):

- A jurisdiction-supplied idempotency key passed in the request header.
- A submission ID derived from `RenderedClaim.contentHashSha256Hex`.
- A pre-submit query — "do you already have a claim with this content?"

**Test pattern:** call `submit` twice with the same rendered artifact; assert both receipts reference the same upstream resource ID.

### Obligation 5 — no credential persistence

The adapter MUST NOT write `SubmitterCredentials.material` to disk, log, or any non-volatile store. Cert private keys are the highest-value secret in regulated billing channels; spilling them is a real incident.

**Pattern to follow:**
- Hold credentials only as long as the call needs.
- Grep your adapter code for `console.log`, `tracing.info`, `JSON.stringify` near credential paths before opening a PR. Reviewers will too.
- For multi-step submission flows, pass credentials through as parameters; don't stash them on the adapter instance.

### Obligation 6 — stateless across invocations

All state required for `poll` MUST live in the persisted `SubmitReceipt`. Consumers persist the receipt and may call `poll` from a different process, days later, after a restart. The adapter constructor takes static config; methods take per-call data; no instance state mutates across calls.

**OHIP example:** [`packages/billing-adapter-ohip/src/index.ts`](../../packages/billing-adapter-ohip/src/index.ts) stores `config` and `validationOptions` as `private readonly` fields and `Object.freeze`s them in the constructor (with a `Date` clone for `validationOptions.now`). The class never mutates them. `validate` and `render` take per-call `ClaimBatch` arguments and produce return values; nothing accumulates on the instance. A regression test mutates the caller's config object after construction and asserts byte-identical render output.

**Pattern to follow:**
- Make instance fields `readonly` and freeze them in the constructor (deep-freeze nested objects; clone `Date`s).
- For `submit` (Phase 2+), put everything `poll` will need into the returned `SubmitReceipt`.
- Test by alternating renders against the same instance with different batches; assert each batch produces consistent output.

## Encoding the wire format

For fixed-width / record-oriented formats (Ontario MCEDT, US X12 837, German KBV), the structure that's worked well in OHIP is:

1. **Per-record encoders** — one pure function per record type returning a `Uint8Array` of the exact wire-format width. These reject non-conforming input via a discriminated `EncodeError` union rather than silently producing malformed bytes.
2. **A file-level orchestrator** — composes the encoders, threads counts through, computes the content hash. Reads from a static config; never mutates instance state.
3. **A pre-flight validator** — sees the full batch + config, aggregates every wire-format-level finding into a `ValidationReport`.

See [`docs/architecture/ohip-record-format.md`](./ohip-record-format.md) for OHIP's authoritative byte-layout reference. Your jurisdiction's analog goes in your own package's docs.

For non-fixed-width formats (REST/JSON, FHIR Bundle on the wire, EDIFACT), the same three-layer split usually still applies — encoders become field-emitters or builders, the orchestrator becomes a serializer, and the validator stays the same shape.

## Phase 2+: extending to `ClaimSubmitter`

Add `submit` and `poll` only after your deployment has passed the jurisdiction's conformance testing. The Phase 2+ shape:

```typescript
export class MyJurisdictionAdapter implements ClaimSubmitter {
  // ...everything from Phase 1...

  async submit(
    rendered: RenderedClaim,
    submitter: SubmitterIdentity,
    credentials: SubmitterCredentials,
  ): Promise<SubmitReceipt> {
    // Idempotent on the receipt level (obligation 4).
    // Never persist credentials (obligation 5).
    // Return everything `poll` will need (obligation 6).
  }

  async poll(
    receipt: SubmitReceipt,
    credentials: SubmitterCredentials,
  ): Promise<PollOutcome> {
    // At most one round-trip per call. Caller manages cadence + backoff.
    // Returns either `{ kind: 'pending' }` or `{ kind: 'resolved', result }`.
  }
}
```

`canSubmit(adapter)` then narrows to `ClaimSubmitter` for callers that feature-detect the tier. (See [#24](https://github.com/loomantix/billing-substrate/issues/24) for tier-discipline work that may make this an explicit `tier` flag rather than method-presence detection.)

## Testing strategy

Three layers, all pulling their weight in OHIP:

1. **Unit tests per encoder / per validator rule.** Cover golden bytes, character-class violations, width violations, missing fields. These are your fastest feedback loop while developing.
2. **Property tests** for invariants that should hold over arbitrary valid inputs — e.g. "every encoder always returns exactly N bytes" or "all output bytes are 7-bit printable ASCII." OHIP uses `fast-check`; any property-test library works.
3. **End-to-end integration tests** through the public adapter class. These exercise the full validate → render flow, the determinism guarantee (multi-render byte equality + hash equality), and the error-translation surface.

OHIP carries 158+ tests across these layers; your adapter doesn't need to match the count, but each obligation should have at least one direct test.

## Errors at the contract boundary

`render` MUST throw `AdapterErrorException` — the `Error` subclass exported from `@loomantix/billing-adapter` that wraps the discriminated `AdapterError` payload. Never throw the bare payload; never throw an adapter-private exception type across the public boundary. The wrapper is what restores `instanceof Error`, stack traces, and structured-logger fingerprinting that consumers rely on (pino, Sentry, OTel exporters).

If your encoder layer detects an invariant the validator missed, translate to `AdapterErrorException` wrapping `{ kind: 'validation', report }` carrying a synthesized `ValidationReport` — these are consumer-fixable structural problems, not jurisdiction rejections. Reserve `{ kind: 'rejected' }` for actual jurisdiction rejections (Phase 2+).

**OHIP example:** the `translateRenderException` helper in [`packages/billing-adapter-ohip/src/index.ts`](../../packages/billing-adapter-ohip/src/index.ts) returns a bare `AdapterError` payload that the `render` method then wraps in `new AdapterErrorException(...)` at the throw site. Known `EmitException` / `EncodeException` translate into `{ kind: 'validation' }` with synthesized single-violation reports; unknown exceptions fall through to `{ kind: 'rejected' }` with a stable `'internal-error'` code and a sanitized generic message.

**PHI scrubbing:** every string surfaced through the contract boundary MUST be free of patient identifiers. That includes the message fields on `AdapterError` variants that carry one (`transport.message`, `auth.message`, `rejected.message`), every `ValidationViolation.message` inside a `validation`-variant `report`, and therefore the wrapper's `Error.message` (which is derived from those). The OHIP adapter's `describeEmitError` strips `groupKey` contents (`${HIN}|${DoB}|${date}` triples) at translation time. Internal exception paths can carry the full key for in-process debugging; only the contract surface is sanitized.

`Error.cause` also crosses the boundary — structured loggers (Sentry, OTel, `util.inspect`) serialize cause chains by default. Adapters MUST NOT attach internal exceptions that carry PHI as the wrapper's `cause`. The OHIP adapter deliberately does not propagate `EmitException` / `EncodeException` into `cause` for this reason; server-side debugging relies on the wrapper's stack frame plus the synthesized violation's `code` and `path`. The contract package's `describeAdapterError` formats the payload but does not sanitize — scrubbing remains the adapter's obligation.

## Publishing

**Under your own scope** (`@<your-org>/billing-adapter-<jurisdiction>`):

1. `peerDependencies: { "@loomantix/billing-adapter": "^0.0.1" }` (pin the minor; the contract is at v0.0.x and may break at minor bumps until 1.0).
2. License under Apache 2.0 or compatible — the contract package is Apache 2.0; no copyleft adapters can use it without re-licensing.
3. Publish to npm. No coordination with Loomantix needed.

**Upstream as `@loomantix/billing-adapter-<jurisdiction>`:**

See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — open an issue first describing the jurisdiction, wire format, transport, conformance regime, and your motivation. We work through fit before you start implementation. Every commit needs DCO sign-off (`git commit -s`).

## Cross-references

- [`contract-design.md`](./contract-design.md) — the formal spec (read first)
- [`ohip-record-format.md`](./ohip-record-format.md) — Ontario MCEDT byte-layout reference (concrete example of jurisdiction-specific format docs)
- [`packages/billing-adapter/src/index.ts`](../../packages/billing-adapter/src/index.ts) — source of truth for type signatures
- [`packages/billing-adapter-ohip/`](../../packages/billing-adapter-ohip/) — the canonical reference implementation
