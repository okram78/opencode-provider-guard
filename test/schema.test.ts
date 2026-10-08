import { readFile } from "node:fs/promises"
import { Ajv2020 } from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

const schema: unknown = JSON.parse(
  await readFile(new URL("../schema.json", import.meta.url), "utf8"),
)
const validate = new Ajv2020({ strict: true }).compile(schema as object)

describe("published options schema", () => {
  it.each([
    "~/projects/work",
    "~",
    "/work",
    "C:\\work",
    "C:/work",
    "\\\\server\\share\\work",
  ])("accepts documented path forms: %s", (root) => {
    expect(
      validate({ rules: [{ root, allowProviders: ["github-copilot"] }] }),
    ).toBe(true)
  })

  it("permits explicit deny-all and harmless duplicate provider IDs", () => {
    expect(validate({ rules: [{ root: "/work", allowProviders: [] }] })).toBe(
      true,
    )
    expect(
      validate({
        rules: [
          {
            root: "/work",
            allowProviders: ["github-copilot", "github-copilot"],
          },
        ],
      }),
    ).toBe(true)
  })

  it.each([
    "relative/work",
    "~john/work",
    "/work/*",
    "/work/?",
    "/work\0secret",
    " /work",
    "/work ",
    "/work\n",
    "",
  ])("rejects malformed roots: %s", (root) => {
    expect(
      validate({ rules: [{ root, allowProviders: ["github-copilot"] }] }),
    ).toBe(false)
  })

  it.each([
    "github-*",
    "github-copilot/model",
    "github-copilot\n",
    " github-copilot",
    "",
  ])("rejects malformed provider IDs: %s", (provider) => {
    expect(
      validate({ rules: [{ root: "/work", allowProviders: [provider] }] }),
    ).toBe(false)
  })

  it.each([
    {},
    { rules: [] },
    { rules: [{}] },
    { rules: [{ root: "/work", allowProvider: [] }] },
    { rules: [{ root: "/work", allowProviders: [] }], enabled: false },
  ])("rejects malformed option shapes %#", (options) => {
    expect(validate(options)).toBe(false)
  })
})
