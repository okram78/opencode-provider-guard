import { Plugin } from "@opencode/plugin"
import { setupGuard } from "./guard.js"

export type { GuardOptions, GuardRule } from "./config.js"
export { ProviderGuardError } from "./errors.js"
export type { GuardErrorCode } from "./errors.js"

export default Plugin.define({
  id: "opencode-provider-guard",
  setup: setupGuard,
})
