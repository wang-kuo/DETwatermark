// SHA-256 helper used on BOTH sides of the wire:
//   - the browser computes the hash before upload (dedup hint + integrity)
//   - the server recomputes it from the received bytes to prevent spoofing
//
// Implemented with the Web Crypto API (`crypto.subtle`), which exists in modern
// browsers (secure contexts: https / localhost) and in the Next.js Node runtime
// (Node 18+ exposes it as a global). No Node-only APIs here, so this module is
// safe to bundle into client components.

/** Returns the lowercase hex SHA-256 digest of the given bytes. */
export async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // `as BufferSource`: TS's default Uint8Array generic admits SharedArrayBuffer,
  // which the DOM lib's BufferSource excludes. We never deal in SharedArrayBuffer.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toHex(digest);
}

/** Convenience wrapper for hashing a Blob/File directly. */
export async function sha256OfBlob(blob: Blob): Promise<string> {
  return sha256(await blob.arrayBuffer());
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
