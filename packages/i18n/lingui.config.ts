import { defineConfig } from "@lingui/cli"
import { formatter } from "@lingui/format-po"

export default defineConfig({
  sourceLocale: "en",
  compileNamespace: "ts",
  locales: ["en", "pt-BR", "es"],
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: [
        "<rootDir>/../../apps/web/src",
        "<rootDir>/../ui/src",
        "<rootDir>/../../apps/server/src",
      ],
    },
  ],
  format: formatter({ lineNumbers: false }),
})
