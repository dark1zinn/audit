/**
 * The one answer to "may this server contact that address?". Outbound callers (push endpoints, AI
 * provider base URLs) use it so that the private-range rules live in exactly one place.
 */
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/** Every address a host name resolves to. Injected so tests never depend on real DNS. */
export type Resolve = (hostname: string) => Promise<readonly string[]>

export const resolveHost: Resolve = (hostname) =>
  lookup(hostname, { all: true, verbatim: true }).then((records) =>
    records.map((record) => record.address),
  )

/** Lowercase host without IPv6 brackets or a trailing dot. */
export const normalizeHost = (hostname: string): string =>
  hostname
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "")
    .toLowerCase()

/** `localhost` and its subdomains, which never name a public host. */
export const isLocalName = (host: string): boolean =>
  host === "localhost" || host.endsWith(".localhost")

/** IPv4 octets from dotted-quad text; null when malformed. */
const parseIPv4 = (text: string): ReadonlyArray<number> | null => {
  const parts = text.split(".")
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null
  const octets = parts.map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

/** Hextets of a canonical IPv6 address (as WHATWG URL and `dns.lookup` print it); null if malformed. */
const parseIPv6 = (address: string): ReadonlyArray<number> | null => {
  const halves = address.split("::")
  if (halves.length > 2) return null
  const hextets = (part: string): Array<number> | null => {
    if (part === "") return []
    const pieces = part.split(":")
    const out: Array<number> = []
    for (const [index, piece] of pieces.entries()) {
      if (piece.includes(".")) {
        const octets = parseIPv4(piece)
        if (octets === null || index !== pieces.length - 1) return null
        const [a = 0, b = 0, c = 0, d = 0] = octets
        out.push(a * 256 + b, c * 256 + d)
      } else if (/^[0-9a-f]{1,4}$/i.test(piece)) {
        out.push(Number.parseInt(piece, 16))
      } else {
        return null
      }
    }
    return out
  }
  const head = hextets(halves[0] ?? "")
  if (head === null) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const tail = hextets(halves[1] ?? "")
  if (tail === null) return null
  const fill = 8 - head.length - tail.length
  return fill < 1 ? null : [...head, ...Array.from({ length: fill }, () => 0), ...tail]
}

/** Non-public IPv4 ranges: unspecified, loopback, RFC1918, link-local, CGNAT. */
const privateIPv4 = (octets: ReadonlyArray<number>): boolean => {
  const [a = -1, b = -1] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** Whether an IP literal is a public address. Anything unparsable, or not an IP, is not. */
export const isPublicAddress = (address: string): boolean => {
  const version = isIP(address)
  if (version === 4) {
    const octets = parseIPv4(address)
    return octets !== null && !privateIPv4(octets)
  }
  if (version !== 6) return false
  const hextets = parseIPv6(address)
  if (hextets === null) return false
  const bytes = hextets.flatMap((hextet) => [hextet >> 8, hextet & 0xff])
  const leadingZeros = (count: number) => bytes.slice(0, count).every((byte) => byte === 0)
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d, which also covers :: and ::1).
  if (leadingZeros(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return !privateIPv4(bytes.slice(12))
  }
  if (leadingZeros(12)) return !privateIPv4(bytes.slice(12))
  const [b0 = 0, b1 = 0] = bytes
  // Link-local fe80::/10 and unique-local fc00::/7.
  return !((b0 === 0xfe && (b1 & 0xc0) === 0x80) || (b0 & 0xfe) === 0xfc)
}

/**
 * Every address a host reaches: an IP literal is its own address; a name is resolved. The result
 * is empty when the name does not resolve, so callers treat it as unreachable.
 */
export const hostAddresses = async (host: string, resolve: Resolve): Promise<readonly string[]> => {
  if (isIP(host) !== 0) return [host]
  try {
    return await resolve(host)
  } catch {
    return []
  }
}
