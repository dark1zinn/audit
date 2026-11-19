/** Set by the Bun shell from the socket or trusted proxy headers; a client-sent value is replaced. */
export const CLIENT_IP_HEADER = "x-audit-client-ip"

export const withClientIp = (
  request: Request,
  server: Bun.Server<unknown>,
  trustProxy: boolean,
): Request => {
  const forwarded = trustProxy
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    : undefined
  const ip = forwarded ?? server.requestIP(request)?.address
  const headers = new Headers(request.headers)
  headers.delete(CLIENT_IP_HEADER)
  if (ip !== undefined) headers.set(CLIENT_IP_HEADER, ip)
  return new Request(request, { headers })
}
