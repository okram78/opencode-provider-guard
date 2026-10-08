/** Stable error codes for diagnostics without logging prompts or credentials. */
export type GuardErrorCode =
  | "INVALID_CONFIG"
  | "PATH_RESOLUTION_FAILED"
  | "SESSION_LOOKUP_FAILED"
  | "PROVIDER_BLOCKED"

export class ProviderGuardError extends Error {
  override readonly name = "ProviderGuardError"

  constructor(
    readonly code: GuardErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`[opencode-provider-guard:${code}] ${message}`, options)
  }
}
