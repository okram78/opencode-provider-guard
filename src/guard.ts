import type { Plugin } from "@opencode/plugin"
import type { Registration } from "@opencode/plugin/promise/registration"
import type { SessionRequest } from "@opencode/plugin/promise/session"
import { ProviderGuardError } from "./errors.js"
import { permits, PolicyEngine } from "./policy.js"

type GuardContext = Pick<
  Plugin.Context,
  "options" | "location" | "provider" | "model" | "session"
>
type RequestIdentity = Pick<SessionRequest, "sessionID" | "model">

async function dispose(registrations: readonly Registration[]): Promise<void> {
  const results = await Promise.allSettled(
    [...registrations]
      .reverse()
      .map((registration) =>
        Promise.resolve().then(() => registration.dispose()),
      ),
  )
  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason as unknown)
  if (errors.length)
    throw new AggregateError(
      errors,
      "Provider guard registration cleanup failed.",
    )
}

/** Kept separate from the entrypoint so contract tests need no running service. */
export async function setupGuard(
  ctx: GuardContext,
): Promise<() => Promise<void>> {
  const engine = new PolicyEngine(ctx.options)
  const registrations: Registration[] = []

  const check = async (event: RequestIdentity): Promise<void> => {
    let session: Awaited<ReturnType<typeof ctx.session.get>>
    try {
      session = await ctx.session.get({ sessionID: event.sessionID })
    } catch (cause) {
      throw new ProviderGuardError(
        "SESSION_LOOKUP_FAILED",
        "Cannot determine the session location; refusing the model request.",
        { cause },
      )
    }
    // ctx.location belongs to the plugin instance, not necessarily this session.
    // Never apply a different project's canonical path to an unrelated session.
    const directories = [session.location.directory]
    if (session.projectID === ctx.location.project.id) {
      directories.push(ctx.location.project.canonical)
    }
    const policy = await engine.evaluate(directories)
    if (!permits(policy, event.model.providerID)) {
      throw new ProviderGuardError(
        "PROVIDER_BLOCKED",
        `Provider ${JSON.stringify(event.model.providerID)} is blocked in ${JSON.stringify(session.location.directory)}. Matching roots: ${policy.matchedRoots.map((root) => JSON.stringify(root)).join(", ")}. Allowed providers: ${policy.allowProviders?.join(", ") || "none"}. Select an allowed provider; no automatic fallback is performed.`,
      )
    }
  }

  try {
    // Register even outside protected roots: a session may later move inside.
    for (const name of [
      "context",
      "compaction",
      "generate",
      "title",
      "model.request",
      "http.request",
      "experimental.ws.handshake",
      "experimental.ws.send",
    ] as const) {
      registrations.push(await ctx.session.hook(name, check))
    }

    const policy = await engine.evaluate([
      ctx.location.directory,
      ctx.location.project.canonical,
    ])
    if (policy.allowProviders !== undefined) {
      registrations.push(
        await ctx.provider.transform((editor) => {
          for (const { provider } of editor.list()) {
            if (!permits(policy, provider.id)) editor.remove(provider.id)
          }
        }),
      )
      registrations.push(
        await ctx.model.transform((editor) => {
          for (const model of editor.list()) {
            // V2's DeepMutable maps branded IDs as object types; their runtime
            // values are strings. String() avoids an unsafe type assertion.
            const providerID = String(model.providerID)
            if (!permits(policy, providerID))
              editor.remove(providerID, String(model.id))
          }
        }),
      )
    }
  } catch (error) {
    try {
      await dispose(registrations)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Provider guard setup and cleanup failed.",
      )
    }
    throw error
  }

  return () => dispose(registrations)
}
