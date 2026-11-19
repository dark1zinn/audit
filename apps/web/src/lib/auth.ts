import { passkeyClient } from "@better-auth/passkey/client"
import { twoFactorClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/** Better Auth client for `/api/auth/*`. Same-origin, so session cookies travel automatically. */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  plugins: [twoFactorClient(), passkeyClient()],
})
