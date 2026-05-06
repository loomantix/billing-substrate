/**
 * Jurisdiction-specific cryptographic + identity material an adapter needs
 * at submit/poll time.
 *
 * Opaque shape — each adapter package specifies the keys it requires (e.g.
 * the Ontario MCEDT adapter requires `certificatePem`, `privateKeyPem`,
 * `softwareConformanceId`). The deployment is responsible for materializing
 * credentials from a secrets store and passing them per-request; the
 * adapter MUST NOT persist or log them.
 */

import type { Jurisdiction } from './types.js';

/**
 * Opaque per-jurisdiction credential bag. Values are typed as `string` for
 * PEM-encoded text (certificates, keys), or `Uint8Array` for binary
 * material (DER-encoded keys, raw cipher inputs). Adapters cast the keys
 * they need to the expected type and validate at use time.
 */
export interface SubmitterCredentials {
  readonly jurisdiction: Jurisdiction;
  readonly material: Readonly<Record<string, string | Uint8Array>>;
}
