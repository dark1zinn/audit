/** Decodes a VAPID public key (base64url, as the server sends it) for `pushManager.subscribe`. */
export const urlBase64ToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}
