import { fromPromise } from "@opencode/plugin/promise/adapter"
import type { Plugin as EffectPlugin } from "@opencode/plugin/effect"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { expect, it, vi } from "vitest"
import plugin from "../src/index.js"
import { temporaryDirectories } from "./fixtures.js"

const temp = temporaryDirectories()

it("the real V2 Promise adapter propagates guard failures before dispatch", async () => {
  const directory = await temp()
  const session = Schema.decodeUnknownSync(Session.Info)({
    id: "ses_john_doe",
    projectID: "project-john-doe",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory },
  })
  const hooks = new Map<string, (event: unknown) => Effect.Effect<void>>()
  const dispatch = vi.fn()
  // The adapter constructs every API domain, but this test should never invoke
  // unrelated endpoints. Recursive stubs throw if any is accidentally used.
  const unused: unknown = new Proxy(
    () => {
      throw new Error("Unexpected endpoint invocation")
    },
    {
      get: () => unused,
    },
  )
  const host = {
    ...Object.fromEntries(
      [
        "agent",
        "aisdk",
        "command",
        "event",
        "experimental",
        "integration",
        "generate",
        "mcp",
        "permission",
        "plugin",
        "reference",
        "rpc",
        "shell",
        "skill",
        "storage",
        "tool",
        "vcs",
        "websearch",
        "worktree",
      ].map((name) => [name, unused]),
    ),
    app: { version: "2.0.24" },
    options: {
      rules: [{ root: directory, allowProviders: ["github-copilot"] }],
    },
    location: {
      directory,
      project: { id: session.projectID, directory, canonical: directory },
    },
    provider: {
      transform: () => Effect.succeed({ dispose: Effect.void }),
      get: unused,
      list: unused,
    },
    model: {
      transform: () => Effect.succeed({ dispose: Effect.void }),
      list: unused,
      default: unused,
    },
    session: {
      get: () => Effect.succeed(session),
      hook: (name: string, callback: (event: unknown) => Effect.Effect<void>) =>
        Effect.sync(() => {
          hooks.set(name, callback)
          return {
            dispose: Effect.sync(() => {
              hooks.delete(name)
            }),
          }
        }),
    },
  } as unknown as EffectPlugin.Context

  const adapted = fromPromise(plugin)
  const program = Effect.scoped(
    Effect.gen(function* () {
      yield* adapted.effect(host)
      const check = hooks.get("model.request")
      if (!check) throw new Error("Guard was not registered")
      yield* check({
        sessionID: session.id,
        model: { providerID: "opencode", id: "fictional-model" },
        agent: "build",
        kind: "primary",
        headers: {},
      } as SessionHooks["model.request"])
      dispatch()
    }),
  )
  await expect(Effect.runPromise(program)).rejects.toThrow("PROVIDER_BLOCKED")
  expect(dispatch).not.toHaveBeenCalled()
  expect(hooks.size).toBe(0)
})
