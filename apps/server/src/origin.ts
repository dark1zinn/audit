/**
 * Cross-site request guard. Cookies ride on every same-site request, so state-changing requests and
 * WebSocket upgrades must come from the app's own origin.
 */
const SAFE_METHODS: Record<string, true> = { GET: true, HEAD: true, OPTIONS: true }

const isWebSocketUpgrade = (request: Request): boolean =>
  request.headers.get("upgrade")?.toLowerCase() === "websocket"

/** Whether the request must pass `isSameOriginRequest`: unsafe methods and WebSocket upgrades. */
export const needsOriginCheck = (request: Request): boolean =>
  SAFE_METHODS[request.method.toUpperCase()] !== true || isWebSocketUpgrade(request)

/**
 * Origin must equal the app origin. Without an Origin header, only `Sec-Fetch-Site: same-origin`
 * is accepted, or any WebSocket upgrade (see below). Cross-site, missing, or `null` is refused.
 */
export const isSameOriginRequest = (request: Request, expectedOrigin: string): boolean => {
  const origin = request.headers.get("origin")
  if (origin !== null) return origin === expectedOrigin
  // Browsers always send Origin on a WebSocket handshake, so a missing one comes from a non-browser
  // client, which no cross-site page can make send the user's cookie.
  if (isWebSocketUpgrade(request)) return true
  return request.headers.get("sec-fetch-site") === "same-origin"
}
