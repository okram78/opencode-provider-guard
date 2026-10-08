import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { parseOptions } from "../src/config.js"
import { ProviderGuardError } from "../src/errors.js"

const root = resolve("/work")

describe("configuration", () => {
  it("accepts the requested format and deduplicates IDs", () => {
    const options = parseOptions({
      rules: [
        {
          root: "~/projects/work",
          allowProviders: ["github-copilot", "github-copilot"],
        },
      ],
    })
    expect(options).toEqual({
      rules: [{ root: "~/projects/work", allowProviders: ["github-copilot"] }],
    })
    expect(Object.isFrozen(options.rules[0]?.allowProviders)).toBe(true)
    expect(Object.isFrozen(options.rules[0])).toBe(true)
    expect(Object.isFrozen(options.rules)).toBe(true)
    expect(Object.isFrozen(options)).toBe(true)
  })

  it("copies caller-owned data", () => {
    const input = { rules: [{ root, allowProviders: ["github-copilot"] }] }
    const parsed = parseOptions(input)
    input.rules[0]?.allowProviders.push("opencode")
    expect(parsed.rules[0]?.allowProviders).toEqual(["github-copilot"])
  })

  it("supports an explicit deny-all rule and custom provider IDs", () => {
    expect(
      parseOptions({ rules: [{ root, allowProviders: [] }] }).rules[0]
        ?.allowProviders,
    ).toEqual([])
    expect(
      parseOptions({ rules: [{ root: "~", allowProviders: ["company.ai_1"] }] })
        .rules[0]?.root,
    ).toBe("~")
  })

  it.each([
    undefined,
    null,
    [],
    "rules",
    {},
    { rules: [] },
    { rules: "work" },
    { rules: [null] },
    { rules: [[]] },
    { rules: [{}] },
    { rules: [{ root: 123, allowProviders: [] }] },
    { rules: [{ root: "", allowProviders: [] }] },
    { rules: [{ root: "relative/work", allowProviders: [] }] },
    { rules: [{ root: "~john/work", allowProviders: [] }] },
    { rules: [{ root: " /work", allowProviders: [] }] },
    { rules: [{ root: "/work ", allowProviders: [] }] },
    { rules: [{ root: "/work\0secret", allowProviders: [] }] },
    { rules: [{ root: "/work/*", allowProviders: [] }] },
    { rules: [{ root: "/work/?", allowProviders: [] }] },
    { rules: [{ root }] },
    { rules: [{ root, allowProviders: "github-copilot" }] },
    { rules: [{ root, allowProviders: [null] }] },
    { rules: [{ root, allowProviders: [""] }] },
    { rules: [{ root, allowProviders: [" github-copilot"] }] },
    { rules: [{ root, allowProviders: ["github-copilot\n"] }] },
    { rules: [{ root, allowProviders: ["github-copilot/model"] }] },
    { rules: [{ root, allowProviders: ["github-*"] }] },
    { rules: [{ root, allowProviders: [], allowProvider: [] }] },
    { rules: [{ root, allowProviders: [] }], enabled: false },
  ])("rejects malformed configuration %#", (input) => {
    expect(() => parseOptions(input)).toThrow(ProviderGuardError)
    expect(() => parseOptions(input)).toThrow("INVALID_CONFIG")
  })
})
