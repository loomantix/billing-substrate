/**
 * Jurisdiction-specific cryptographic + identity material an adapter needs
 * at submit/poll time.
 *
 * Opaque shape — each adapter package specifies the keys it requires (e.g.
 * the Ontario MCEDT adapter requires `certificatePem`, `privateKeyPem`,
 * `softwareConformanceId`). The deployment is responsible for materializing
 * credentials from a secrets store and passing them per-request; the
 * adapter MUST NOT persist or log them.
 *
 * The credential bag is a class with `#`-private storage and redacting
 * `toJSON` / `[util.inspect.custom]` hooks rather than a plain object.
 * Three failure modes the bare-object shape used to admit:
 *
 * 1. `JSON.stringify(creds)` — pino/Sentry serialize structured fields
 *    by default. Plain object → cert/key bytes flow into log shipping.
 * 2. `console.log(creds)` / `util.inspect(creds)` — same hazard via
 *    `inspect`. Plain object → key bytes printed.
 * 3. `new Error(\`bad cert: ${creds.material.certificatePem}\`)` — naive
 *    template-string interpolation by an adapter author. The class
 *    surface omits a `material` field entirely; access goes through
 *    `get(key)`, which makes the leak path explicit at the call site.
 */

import type { Jurisdiction } from './types.js';

const REDACTED = '[redacted]';

/**
 * Construction input for `SubmitterCredentials`. Plain shape so callers
 * can build it from a secrets-store result without ceremony.
 */
export interface SubmitterCredentialsInput {
  readonly jurisdiction: Jurisdiction;
  readonly material: Readonly<Record<string, string | Uint8Array>>;
}

/**
 * Opaque per-jurisdiction credential bag. Values are typed as `string`
 * for PEM-encoded text (certificates, keys) or `Uint8Array` for binary
 * material (DER-encoded keys, raw cipher inputs). Adapters request keys
 * via {@link get} and validate at use time.
 *
 * Instances redact themselves under `JSON.stringify`, `util.inspect`,
 * and direct `String(...)` / `${...}` coercion. This is a defense
 * against accidental leakage — adapters and consumers must still
 * follow the contract obligations (no persistence, no logging) when
 * deliberately handling values returned by {@link get}.
 */
export class SubmitterCredentials {
  readonly jurisdiction: Jurisdiction;
  readonly #material: ReadonlyMap<string, string | Uint8Array>;

  constructor(input: SubmitterCredentialsInput) {
    this.jurisdiction = input.jurisdiction;
    // Snapshot Uint8Array values: `Readonly<Record<string, string |
    // Uint8Array>>` makes the property reference immutable but does
    // NOT freeze the bytes inside a Uint8Array. Without copying, a
    // caller holding the input object can mutate cred bytes
    // post-construction (zero them, swap them, exfiltrate via a
    // bound reference) and the change is observable through `get()`.
    // Strings are immutable so they pass through by reference.
    const entries: Array<[string, string | Uint8Array]> = [];
    for (const [key, value] of Object.entries(input.material)) {
      entries.push([key, value instanceof Uint8Array ? new Uint8Array(value) : value]);
    }
    this.#material = new Map(entries);
  }

  /**
   * Retrieve a credential value by key. Returns `undefined` if absent.
   *
   * For `Uint8Array` values, returns the live internal view —
   * cipher operations need direct access. Adapters MUST NOT mutate
   * the returned bytes.
   */
  get(key: string): string | Uint8Array | undefined {
    return this.#material.get(key);
  }

  /** True iff the credential bag carries a value under `key`. */
  has(key: string): boolean {
    return this.#material.has(key);
  }

  /** Snapshot of credential key names (values are not exposed). */
  keys(): readonly string[] {
    return Array.from(this.#material.keys());
  }

  /**
   * Hook used by `JSON.stringify`. Returns a redacted shape so a
   * structured logger that serializes the bag does not leak material.
   */
  toJSON(): { readonly jurisdiction: Jurisdiction; readonly material: typeof REDACTED } {
    return { jurisdiction: this.jurisdiction, material: REDACTED };
  }

  /**
   * Hook used by `util.inspect` / `console.log`. Returns a redacted
   * string representation so a debug print does not leak material.
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `SubmitterCredentials { jurisdiction: ${JSON.stringify(this.jurisdiction)}, material: ${REDACTED} }`;
  }
}
