import type { Plugin } from "@opencode/plugin"
import type { ModelEditor } from "@opencode/plugin/promise/model"
import type { ProviderEditor } from "@opencode/plugin/promise/provider"
import type { SessionHooks } from "@opencode/plugin/promise/session"
import type { Registration } from "@opencode/plugin/promise/registration"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import plugin from "../src/index.js"
import { setupGuard } from "../src/guard.js"
import { temporaryDirectories } from "./fixtures.js"

const temp = temporaryDirectories()
type HookName = keyof SessionHooks
type Identity = Pick<SessionHooks["context"], "sessionID" | "model">
const hookNames = [
  "context",
  "compaction",
  "generate",
  "title",
  "model.request",
  "http.request",
  "experimental.ws.handshake",
  "experimental.ws.send",
] as const

/** Minimal domain fixtures; assertions are confined to the test boundary. */
function fixture(directory: string, root = directory, canonical = directory) {
  const hooks = new Map<HookName, (event: Identity) => Promise<void> | void>()
  const providerTransforms: Array<(editor: ProviderEditor) => void> = []
  const modelTransforms: Array<(editor: ModelEditor) => void> = []
  const disposals: Array<ReturnType<typeof vi.fn<() => Promise<void>>>> = []
  const registration = (): Registration => {
    const dispose = vi.fn(async () => {})
    disposals.push(dispose)
    return { dispose }
  }
  let sessionDirectory = directory
  let projectID = "project-john-doe"
  const get = vi.fn(async () => ({
    location: { directory: sessionDirectory },
    projectID,
  }))
  const hook = vi.fn(
    async (
      name: HookName,
      callback: (event: Identity) => Promise<void> | void,
    ) => {
      hooks.set(name, callback)
      const result = registration()
      const original = result.dispose
      return {
        dispose: async () => {
          hooks.delete(name)
          await original()
        },
      }
    },
  )
  const context = {
    options: { rules: [{ root, allowProviders: ["github-copilot"] }] },
    location: {
      directory,
      project: { id: projectID, directory: canonical, canonical },
    },
    session: { get, hook },
    provider: {
      transform: vi.fn(async (callback: (editor: ProviderEditor) => void) => {
        providerTransforms.push(callback)
        return registration()
      }),
    },
    model: {
      transform: vi.fn(async (callback: (editor: ModelEditor) => void) => {
        modelTransforms.push(callback)
        return registration()
      }),
    },
  }
  return {
    context: context as unknown as Plugin.Context,
    hooks,
    providerTransforms,
    modelTransforms,
    disposals,
    get,
    hook,
    providerTransform: context.provider.transform,
    modelTransform: context.model.transform,
    move: (directory: string) => {
      sessionDirectory = directory
    },
    changeProject: (id: string) => {
      projectID = id
    },
  }
}

function event(providerID: string): Identity {
  return {
    sessionID: "session-john-doe",
    model: { providerID, id: "fictional-model" },
  } as Identity
}

function catalogs(f: ReturnType<typeof fixture>) {
  const providers = ["github-copilot", "opencode", "openai", "new-provider"]
  const removedProviders: string[] = []
  const removedModels: Array<[string, string]> = []
  for (const transform of f.providerTransforms) {
    transform({
      list: () => providers.map((id) => ({ provider: { id } })),
      remove: (id: string) => removedProviders.push(id),
    } as unknown as ProviderEditor)
  }
  for (const transform of f.modelTransforms) {
    transform({
      list: () =>
        providers.map((providerID) => ({ providerID, id: "fictional-model" })),
      remove: (providerID: string, id: string) =>
        removedModels.push([providerID, id]),
    } as unknown as ModelEditor)
  }
  return { removedProviders, removedModels }
}

describe("V2 plugin contract", () => {
  it("exports a V2 plugin, not a V1 callback", () => {
    expect(plugin.id).toBe("opencode-provider-guard")
    expect(plugin.setup).toBe(setupGuard)
  })

  it("filters providers and models, including future registry refreshes", async () => {
    const f = fixture(await temp())
    await setupGuard(f.context)
    for (let replay = 0; replay < 2; replay++) {
      expect(catalogs(f)).toEqual({
        removedProviders: ["opencode", "openai", "new-provider"],
        removedModels: [
          ["opencode", "fictional-model"],
          ["openai", "fictional-model"],
          ["new-provider", "fictional-model"],
        ],
      })
    }
  })

  it.each(hookNames)(
    "blocks forbidden requests at %s without dispatch",
    async (name) => {
      const f = fixture(await temp())
      await setupGuard(f.context)
      const dispatch = vi.fn()
      const request = async () => {
        await f.hooks.get(name)?.(event("opencode"))
        dispatch()
      }
      await expect(request()).rejects.toMatchObject({
        code: "PROVIDER_BLOCKED",
      })
      expect(dispatch).not.toHaveBeenCalled()
      expect(f.get).toHaveBeenCalledWith({ sessionID: "session-john-doe" })
    },
  )

  it.each(hookNames)("preserves allowed requests at %s", async (name) => {
    const f = fixture(await temp())
    await setupGuard(f.context)
    await expect(
      Promise.resolve(f.hooks.get(name)?.(event("github-copilot"))),
    ).resolves.toBeUndefined()
  })

  it("does not modify requests or silently switch models", async () => {
    const f = fixture(await temp())
    await setupGuard(f.context)
    const request = Object.freeze({
      ...event("github-copilot"),
      model: Object.freeze(event("github-copilot").model),
    })
    await f.hooks.get("context")?.(request)
    expect(request.model.providerID).toBe("github-copilot")
    expect([...f.hooks.keys()]).toEqual(hookNames)
  })

  it("leaves unprotected catalogs unchanged but guards a subsequent session move", async () => {
    const directory = await temp()
    const f = fixture(join(directory, "personal"), join(directory, "work"))
    await setupGuard(f.context)
    expect(f.providerTransform).not.toHaveBeenCalled()
    expect(f.modelTransform).not.toHaveBeenCalled()
    await f.hooks.get("context")?.(event("opencode"))
    f.move(join(directory, "work", "project"))
    await expect(
      f.hooks.get("context")?.(event("opencode")),
    ).rejects.toMatchObject({ code: "PROVIDER_BLOCKED" })
  })

  it("protects worktrees outside the root using the canonical project path", async () => {
    const directory = await temp()
    const f = fixture(
      join(directory, "trees", "feature"),
      join(directory, "work"),
      join(directory, "work", "app"),
    )
    await setupGuard(f.context)
    await expect(
      f.hooks.get("context")?.(event("opencode")),
    ).rejects.toMatchObject({ code: "PROVIDER_BLOCKED" })
    expect(catalogs(f).removedProviders).toContain("opencode")
  })

  it("does not apply this plugin instance's location to another project", async () => {
    const directory = await temp()
    const f = fixture(join(directory, "work"))
    await setupGuard(f.context)
    f.move(join(directory, "personal"))
    f.changeProject("project-matti-meikalainen")
    await expect(
      Promise.resolve(f.hooks.get("context")?.(event("opencode"))),
    ).resolves.toBeUndefined()
  })

  it("reports actionable errors without prompt or credential data", async () => {
    const f = fixture(await temp())
    await setupGuard(f.context)
    await expect(f.hooks.get("title")?.(event("opencode"))).rejects.toThrow(
      /Allowed providers: github-copilot.*no automatic fallback/u,
    )
  })

  it("reports deny-all rules without selecting a fallback", async () => {
    const f = fixture(await temp())
    const context = {
      ...f.context,
      options: {
        rules: [{ root: f.context.location.directory, allowProviders: [] }],
      },
    }
    await setupGuard(context)
    await expect(
      f.hooks.get("context")?.(event("github-copilot")),
    ).rejects.toThrow("Allowed providers: none")
    expect(catalogs(f).removedProviders).toHaveLength(4)
  })

  it("fails closed if the session lookup fails", async () => {
    const f = fixture(await temp())
    await setupGuard(f.context)
    const cause = new Error("session unavailable")
    f.get.mockRejectedValueOnce(cause)
    await expect(
      f.hooks.get("context")?.(event("opencode")),
    ).rejects.toMatchObject({ code: "SESSION_LOOKUP_FAILED", cause })
  })

  it("rejects invalid options before registering anything", async () => {
    const f = fixture(await temp())
    const context = { ...f.context, options: { rules: [] } }
    await expect(setupGuard(context)).rejects.toMatchObject({
      code: "INVALID_CONFIG",
    })
    expect(f.hook).not.toHaveBeenCalled()
  })

  it("rolls back partial setup if a later registration fails", async () => {
    const f = fixture(await temp())
    const cause = new Error("model transform failed")
    f.modelTransform.mockRejectedValueOnce(cause)
    await expect(setupGuard(f.context)).rejects.toBe(cause)
    expect(f.disposals).toHaveLength(hookNames.length + 1)
    for (const dispose of f.disposals) expect(dispose).toHaveBeenCalledOnce()
    expect(f.hooks.size).toBe(0)
  })

  it("cleans up a partial hook registration failure", async () => {
    const f = fixture(await temp())
    f.hook.mockRejectedValueOnce(new Error("hook unavailable"))
    await expect(setupGuard(f.context)).rejects.toThrow("hook unavailable")
    expect(f.providerTransform).not.toHaveBeenCalled()
  })

  it("unloads every registration", async () => {
    const f = fixture(await temp())
    const cleanup = await setupGuard(f.context)
    await cleanup()
    expect(f.hooks.size).toBe(0)
    for (const dispose of f.disposals) expect(dispose).toHaveBeenCalledOnce()
  })

  it("tries all disposals even when one fails", async () => {
    const f = fixture(await temp())
    const cleanup = await setupGuard(f.context)
    f.disposals[0]?.mockRejectedValueOnce(new Error("disposal failed"))
    await expect(cleanup()).rejects.toThrow(AggregateError)
    for (const dispose of f.disposals) expect(dispose).toHaveBeenCalledOnce()
  })

  it("tries all disposals even if a disposer throws synchronously", async () => {
    const f = fixture(await temp())
    const cleanup = await setupGuard(f.context)
    f.disposals.at(-1)?.mockImplementationOnce(() => {
      throw new Error("synchronous disposal failure")
    })
    await expect(cleanup()).rejects.toThrow(AggregateError)
    for (const dispose of f.disposals) expect(dispose).toHaveBeenCalledOnce()
  })

  it("retains both setup and rollback errors", async () => {
    const f = fixture(await temp())
    f.modelTransform.mockImplementationOnce(async () => {
      f.disposals[0]?.mockRejectedValueOnce(new Error("cleanup failed"))
      throw new Error("setup failed")
    })
    await expect(setupGuard(f.context)).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "setup failed" }),
        expect.any(AggregateError),
      ],
    })
  })
})
