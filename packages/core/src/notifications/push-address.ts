/**
 * Refuses push endpoints whose host is, or resolves to, a non-public address. Push endpoints come
 * from browsers, so an attacker could otherwise point the server at internal services.
 */
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/** Every address a host name resolves to. Injected so tests never depend on real DNS. */
export type Resolve = (hostname: string) => Promise<readonly string[]>

export const resolveHost: Resolve = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address)

const ipv4Public = (a: number, b: number): boolean =>
  !(
    a === 0 || // this network, including unspecified
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )

/** Expands an IPv6 literal (already validated by `isIP`) into its eight 16-bit groups. */
const ipv6Groups = (address: string): number[] => {
  const dotted = address.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  let text = address
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number]
    const high = ((a << 8) | b).toString(16)
    const low = ((c << 8) | d).toString(16)
    text = `${address.slice(0, -dotted[0].length)}${high}:${low}`
  }
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => parseInt(g, 16)))
  if (!text.includes("::")) return parse(text)
  const [head, tail] = text.split("::") as [string, string]
  const left = parse(head)
  const right = parse(tail)
  return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right]
}

const ipv6Public = (groups: readonly number[]): boolean => {
  if (groups.length !== 8) return false
  const zeroTo = (end: number) => groups.slice(0, end).every((group) => group === 0)
  if (zeroTo(8)) return false // unspecified ::
  if (zeroTo(7) && groups[7] === 1) return false // loopback ::1
  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible (::a.b.c.d) forms.
  if ((zeroTo(5) && groups[5] === 0xffff) || zeroTo(6)) {
    const hi = groups[6] as number
    const lo = groups[7] as number
    return ipv4Public(hi >> 8, hi & 0xff) && ipv4Public(lo >> 8, lo & 0xff)
  }
  if ((groups[0]! & 0xffc0) === 0xfe80) return false // link-local fe80::/10
  if ((groups[0]! & 0xfe00) === 0xfc00) return false // unique local fc00::/7
  return true
}

/** True for an IP literal that may be contacted. Anything that is not an IP is not public here. */
export const isPublicAddress = (address: string): boolean => {
  const family = isIP(address)
  if (family === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number]
    return ipv4Public(a, b)
  }
  if (family === 6) return ipv6Public(ipv6Groups(address))
  return false
}

/**
 * Whether a push endpoint's host may receive a push. IP literals are checked without DNS; a host
 * name must resolve, and every address it resolves to must be public. Callers check the URL shape
 * first (see `isPushEndpoint`).
 */
export const endpointAllowed = async (endpoint: string, resolve: Resolve): Promise<boolean> => {
  const host = new URL(endpoint).hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "")
  const name = host.toLowerCase()
  if (name === "localhost" || name.endsWith(".localhost")) return false
  if (isIP(name) !== 0) return isPublicAddress(name)
  let addresses: readonly string[]
  try {
    addresses = await resolve(name)
  } catch {
    return false
  }
  return addresses.length > 0 && addresses.every(isPublicAddress)
}
