/**
 * Safe UUID v4 generator for web / PWA / LAN environments.
 *
 * Browsers only expose crypto.randomUUID() in secure contexts (HTTPS or localhost).
 * When accessed via LAN HTTP (e.g. http://10.227.207.200:5173), crypto.randomUUID
 * is undefined in many modern browsers.
 *
 * Fallback priority:
 * 1. crypto.randomUUID() if available (native standard).
 * 2. crypto.getRandomValues() if available (cryptographically secure RFC4122 v4).
 * 3. Math.random() RFC4122 v4 pattern as safe frontend-only fallback.
 */
export function createUUID(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }

  // Secure random fallback if Web Crypto getRandomValues is available.
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)

    bytes[6] = (bytes[6] & 0x0f) | 0x40 // RFC4122 version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC4122 variant 1

    const hex = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-')
  }

  // Last-resort frontend-only fallback.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
