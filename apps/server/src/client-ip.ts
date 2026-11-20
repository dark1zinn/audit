/** Set by the Bun shell from the socket or trusted proxy headers; a client-sent value is replaced. */
export const CLIENT_IP_HEADER = "x-audit-client-ip"

/**
 * The client is the entry `hops` places from the right of X-Forwarded-For: each trusted proxy
 * appends the peer it received from, so anything further left is client-controlled.
 */
export const clientIpFromForwarded = (forwardedFor: string, hops: number): string | undefined => {
  const entries = forwardedFor.split(",").map((entry) => entry.trim())
  const index = entries.length - hops
  if (index < 0) return undefined
  const ip = entries[index]
  return ip === undefined || ip === "" ? undefined : ip
}

/**
 * Stamps the client address for Better Auth, rate limits and the trail. `socketIp` must come from
 * `server.requestIP()` on the request Bun handed to `fetch`: Bun resolves the socket only for that
 * object, never for a rebuilt `new Request(...)`.
 */
export const withClientIp = (
  request: Request,
  socketIp: string | undefined,
  trustProxy: boolean,
  trustProxyHops = 1,
): Request => {
  const forwardedFor = trustProxy ? request.headers.get("x-forwarded-for") : null
  const forwarded =
    forwardedFor === null ? undefined : clientIpFromForwarded(forwardedFor, trustProxyHops)
  const ip = forwarded ?? socketIp
  const headers = new Headers(request.headers)
  headers.delete(CLIENT_IP_HEADER)
  if (ip !== undefined) headers.set(CLIENT_IP_HEADER, ip)
  return new Request(request, { headers })
}
