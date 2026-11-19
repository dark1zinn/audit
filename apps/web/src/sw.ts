/**
 * Service worker: precaches the built app shell and shows Web Push notifications.
 * Built by vite-plugin-pwa (injectManifest); `self.__WB_MANIFEST` is injected at build time.
 */
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching"

interface PushPayload {
  readonly title?: string
  readonly body?: string
  readonly url?: string
}

declare global {
  interface Window {
    readonly __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
  }
}

interface WorkerScope {
  readonly registration: { showNotification(title: string, options?: object): Promise<void> }
  readonly clients: {
    claim(): Promise<void>
    openWindow(url: string): Promise<unknown>
    matchAll(options: {
      type: "window"
      includeUncontrolled: boolean
    }): Promise<ReadonlyArray<{ url: string; focus(): Promise<unknown> }>>
  }
  skipWaiting(): Promise<void>
  addEventListener(type: "install" | "activate", listener: () => void): void
  addEventListener(
    type: "push",
    listener: (event: {
      data?: { json(): unknown } | null
      waitUntil(p: Promise<unknown>): void
    }) => void,
  ): void
  addEventListener(
    type: "notificationclick",
    listener: (event: {
      notification: { close(): void; data?: { url?: string } }
      waitUntil(p: Promise<unknown>): void
    }) => void,
  ): void
}

const sw = self as unknown as WorkerScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

sw.addEventListener("install", () => {
  void sw.skipWaiting()
})

sw.addEventListener("activate", () => {
  void sw.clients.claim()
})

sw.addEventListener("push", (event) => {
  const payload = (event.data?.json() ?? {}) as PushPayload
  event.waitUntil(
    sw.registration.showNotification(payload.title ?? "audit", {
      body: payload.body ?? "",
      icon: "/icon.svg",
      data: { url: payload.url ?? "/" },
    }),
  )
})

sw.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? "/"
  event.waitUntil(
    sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((window) => new URL(window.url).origin === self.location.origin)
      if (existing !== undefined) {
        await existing.focus()
        return
      }
      await sw.clients.openWindow(url)
    }),
  )
})
