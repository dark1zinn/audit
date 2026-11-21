import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { mock } from "bun:test"
import * as lingui from "./lingui-macro.ts"

// Import this file first in every component test. It is not a root preload, so server tests
// keep the default non-DOM environment.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })

mock.module("@lingui/react/macro", () => lingui)
mock.module("@lingui/core/macro", () => ({ t: lingui.t }))
