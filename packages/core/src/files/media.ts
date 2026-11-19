/**
 * Pure helpers for uploaded bytes: the MIME type comes from the content, never the client; the
 * digest and thumbnail are derived from the same bytes.
 */
import { fileTypeFromBuffer } from "file-type"

/** Images above this many pixels get no thumbnail (decoding them costs too much memory). */
export const THUMBNAIL_MAX_PIXELS = 40_000_000
const THUMBNAIL_SIZE = 512
const THUMBNAIL_MIMES: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true,
  "image/gif": true,
  "image/bmp": true,
}
const INLINE_MIMES: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true,
  "image/gif": true,
  "image/avif": true,
  "application/pdf": true,
}

/** Images and PDFs render in the browser; everything else downloads as an attachment. */
export const isInlineMime = (mime: string): boolean => INLINE_MIMES[mime] === true

/** The type a file is served as: sniffed from its bytes, else plain text or opaque binary. */
export const sniffMime = async (bytes: Uint8Array): Promise<string> => {
  const detected = await fileTypeFromBuffer(bytes)
  if (detected !== undefined) return detected.mime
  const sample = bytes.subarray(0, 8192)
  if (sample.includes(0)) return "application/octet-stream"
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample)
    return "text/plain; charset=utf-8"
  } catch {
    return "application/octet-stream"
  }
}

export const sha256Hex = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

/**
 * A WebP thumbnail of an image, or `null` when there is none: unsupported formats, undecodable
 * data and images over the pixel cap all just go without one.
 */
export const makeThumbnail = async (
  bytes: Uint8Array,
  mime: string,
): Promise<Uint8Array | null> => {
  if (THUMBNAIL_MIMES[mime] !== true) return null
  try {
    return await new Bun.Image(bytes, { maxPixels: THUMBNAIL_MAX_PIXELS })
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .bytes()
  } catch {
    return null
  }
}

/** Keeps only the last path segment, drops control characters and bounds the length. */
export const cleanFileName = (raw: string): string => {
  const base = raw.split(/[\\/]/).pop() ?? ""
  const cleaned = base
    // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
    .replaceAll(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255)
  return cleaned.length > 0 ? cleaned : "file"
}
