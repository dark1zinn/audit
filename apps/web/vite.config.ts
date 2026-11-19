import { lingui } from "@lingui/vite-plugin"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const API_ORIGIN = "http://localhost:3000"
const linguiConfigPath = fileURLToPath(
  new URL("../../packages/i18n/lingui.config.ts", import.meta.url),
)

const proxy = {
  "/api": { target: API_ORIGIN, changeOrigin: false },
  "/rpc": { target: API_ORIGIN.replace("http", "ws"), ws: true, changeOrigin: false },
  "/collab": { target: API_ORIGIN.replace("http", "ws"), ws: true, changeOrigin: false },
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    ...lingui({ macroTransform: true, configPath: linguiConfigPath }),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false,
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      manifest: {
        name: "audit",
        short_name: "audit",
        display: "standalone",
        theme_color: "#4f46e5",
        background_color: "#ffffff",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173, proxy },
  preview: { host: "localhost", port: 4173, proxy },
})
