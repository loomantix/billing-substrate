/**
 * Jurisdiction-specific cryptographic + identity material an adapter
 * needs at submit/poll time. Each adapter package specifies the keys
 * it requires; the deployment materializes them from a secrets store
 * per-request. Adapters MUST NOT persist or log them — see
 * {@link SubmitterCredentials} for the redaction defenses.
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
 * Opaque per-jurisdiction credential bag. Values are typed `string`
 * for PEM text and `Uint8Array` for binary material. Instances redact
 * themselves under `JSON.stringify` and `util.inspect`; access goes
 * through {@link get} so accidental template-string interpolation of
 * the bag (`${creds}`) cannot expose material.
 */
export class SubmitterCredentials {
  readonly jurisdiction: Jurisdiction;
  readonly #material: ReadonlyMap<string, string | Uint8Array>;

  constructor(input: SubmitterCredentialsInput) {
    this.jurisdiction = input.jurisdiction;
    // Snapshot binary values — `Readonly<>` only freezes the property
    // reference, not the buffer contents. Buffer (Uint8Array subclass)
    // is downgraded to plain Uint8Array; consumers needing Buffer
    // methods on the way out should wrap the returned view themselves.
    const entries: Array<[string, string | Uint8Array]> = [];
    for (const [key, value] of Object.entries(input.material)) {
      if (typeof value === 'string') {
        entries.push([key, value]);
      } else if (value instanceof Uint8Array) {
        entries.push([key, new Uint8Array(value)]);
      } else {
        throw new TypeError(
          `SubmitterCredentials.material[${JSON.stringify(key)}] must be string or Uint8Array`,
        );
      }
    }
    this.#material = new Map(entries);
  }

  /**
   * Retrieve a credential value by key, or `undefined` if absent.
   * `Uint8Array` values are returned as the live internal view so
   * cipher operations can read them directly; callers MUST NOT mutate
   * AND MUST NOT interpolate the returned value into log/error
   * strings — the redaction defenses on this class only protect the
   * bag, not its emitted values.
   */
  get(key: string): string | Uint8Array | undefined {
    return this.#material.get(key);
  }

  /** True iff the credential bag carries a value under `key`. */
  has(key: string): boolean {
    return this.#material.has(key);
  }

  /** Snapshot of credential key names (values are not exposed). */
  keys(): ReadonlyArray<string> {
    return Array.from(this.#material.keys());
  }

  toJSON(): { readonly jurisdiction: Jurisdiction; readonly material: typeof REDACTED } {
    return { jurisdiction: this.jurisdiction, material: REDACTED };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `SubmitterCredentials { jurisdiction: ${JSON.stringify(this.jurisdiction)}, material: ${REDACTED} }`;
  }
}
