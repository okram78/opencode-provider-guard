import { mkdir, realpath, symlink, unlink } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { permits, PolicyEngine } from "../src/policy.js"
import { temporaryDirectories } from "./fixtures.js"

const temp = temporaryDirectories()

describe("policy evaluation", () => {
  it("allows every provider outside protected roots", async () => {
    const directory = await temp()
    const engine = new PolicyEngine({
      rules: [
        { root: join(directory, "work"), allowProviders: ["github-copilot"] },
      ],
    })
    const policy = await engine.evaluate([join(directory, "work-personal")])
    expect(policy).toEqual({ matchedRoots: [], allowProviders: undefined })
    expect(permits(policy, "opencode")).toBe(true)
  })

  it("allows exact IDs only inside protected roots", async () => {
    const directory = await temp()
    const root = join(directory, "work")
    const policy = await new PolicyEngine({
      rules: [{ root, allowProviders: ["github-copilot"] }],
    }).evaluate([root])
    expect(policy.matchedRoots).toEqual([root])
    expect(permits(policy, "github-copilot")).toBe(true)
    expect(permits(policy, "opencode")).toBe(false)
    expect(permits(policy, "github-copilot-enterprise")).toBe(false)
    expect(permits(policy, "GitHub-Copilot")).toBe(false)
  })

  it("intersects overlapping rules regardless of order", async () => {
    const directory = await temp()
    const root = join(directory, "work")
    const nested = join(root, "restricted")
    const rules = [
      { root, allowProviders: ["github-copilot", "company-ai"] },
      { root: nested, allowProviders: ["company-ai", "opencode"] },
    ]
    for (const order of [rules, [...rules].reverse()]) {
      const policy = await new PolicyEngine({ rules: order }).evaluate([nested])
      expect(policy.allowProviders).toEqual(["company-ai"])
      expect(permits(policy, "opencode")).toBe(false)
    }
  })

  it("denies all when allowlists are empty or disjoint", async () => {
    const root = await temp()
    for (const rules of [
      [{ root, allowProviders: [] }],
      [
        { root, allowProviders: ["github-copilot"] },
        { root, allowProviders: ["company-ai"] },
      ],
    ]) {
      const policy = await new PolicyEngine({ rules }).evaluate([root])
      expect(policy.allowProviders).toEqual([])
      expect(permits(policy, "github-copilot")).toBe(false)
    }
  })

  it("protects worktrees through a supplied canonical project directory", async () => {
    const directory = await temp()
    const root = join(directory, "work")
    const policy = await new PolicyEngine({
      rules: [{ root, allowProviders: ["github-copilot"] }],
    }).evaluate([join(directory, "trees", "feature"), join(root, "app")])
    expect(policy.allowProviders).toEqual(["github-copilot"])
  })

  it("protects aliases into and out of a protected root", async () => {
    const directory = await temp()
    const work = join(directory, "work")
    const outside = join(directory, "personal")
    await mkdir(work)
    await mkdir(outside)
    const alias = join(directory, "alias")
    await symlink(work, alias, "junction")
    await symlink(outside, join(work, "external"), "junction")
    const engine = new PolicyEngine({
      rules: [{ root: work, allowProviders: ["github-copilot"] }],
    })
    expect((await engine.evaluate([alias])).allowProviders).toEqual([
      "github-copilot",
    ])
    expect(
      (await engine.evaluate([join(work, "external")])).allowProviders,
    ).toEqual(["github-copilot"])
    const aliasEngine = new PolicyEngine({
      rules: [{ root: alias, allowProviders: ["company-ai"] }],
    })
    expect(
      (await aliasEngine.evaluate([await realpath(work)])).allowProviders,
    ).toEqual(["company-ai"])
  })

  it("rechecks changed symlink targets without a reload", async () => {
    const directory = await temp()
    const root = join(directory, "work")
    const target = join(directory, "target")
    const other = join(directory, "other")
    await mkdir(target)
    await mkdir(other)
    await symlink(target, root, "junction")
    const engine = new PolicyEngine({
      rules: [{ root, allowProviders: ["github-copilot"] }],
    })
    expect((await engine.evaluate([other])).allowProviders).toBeUndefined()
    await unlink(root)
    await symlink(other, root, "junction")
    expect((await engine.evaluate([other])).allowProviders).toEqual([
      "github-copilot",
    ])
  })
})
