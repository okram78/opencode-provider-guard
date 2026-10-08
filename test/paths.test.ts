import { lstat, mkdir, realpath, symlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, parse, resolve, sep } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  containsPath,
  expandHome,
  pathAliases,
  physicalPath,
} from "../src/paths.js"
import { temporaryDirectories } from "./fixtures.js"

const temp = temporaryDirectories()
vi.mock("node:fs/promises", { spy: true })

describe("path handling", () => {
  it("expands only supported home forms", () => {
    const home = resolve("/home/john")
    expect(expandHome("~", home)).toBe(home)
    expect(expandHome("~/projects/work", home)).toBe(
      `${home}${sep}projects/work`,
    )
    expect(expandHome("~/work")).toBe(`${homedir()}${sep}work`)
    expect(expandHome("/work", home)).toBe("/work")
    expect(expandHome("~john/work", home)).toBe("~john/work")
  })

  it("matches components, root, trailing separators, and normalized paths", () => {
    const root = resolve("/work")
    expect(containsPath(root, root)).toBe(true)
    expect(containsPath(root + sep, join(root, "project", "src"))).toBe(true)
    expect(containsPath(root, resolve(root, "app", "..", "other"))).toBe(true)
    expect(containsPath(root, root + "-personal")).toBe(false)
    expect(containsPath(root, resolve(root, ".."))).toBe(false)
    expect(containsPath(root, resolve("/elsewhere/app"))).toBe(false)
    expect(containsPath(parse(root).root, root)).toBe(true)
  })

  it("resolves symlink ancestors of nonexistent paths", async () => {
    const directory = await temp()
    const target = join(directory, "work")
    const alias = join(directory, "alias")
    await mkdir(target)
    await symlink(target, alias, "junction")
    expect(await physicalPath(join(alias, "future", "project"))).toBe(
      join(await realpath(target), "future", "project"),
    )
    expect(await pathAliases(alias)).toEqual([
      ...new Set([alias, await realpath(target)]),
    ])
  })

  it("handles symlink/.. using filesystem semantics and retains lexical spelling", async () => {
    const directory = await temp()
    const target = join(directory, "work", "deep")
    await mkdir(target, { recursive: true })
    await symlink(target, join(directory, "alias"), "junction")
    const input = `${directory}${sep}alias${sep}..`
    expect(await physicalPath(input)).toBe(
      await realpath(join(directory, "work")),
    )
    expect(await pathAliases(input)).toContain(resolve(directory))
  })

  it.each(["relative", "/work\0secret"])(
    "rejects invalid runtime paths: %s",
    async (path) => {
      await expect(physicalPath(path)).rejects.toMatchObject({
        code: "PATH_RESOLUTION_FAILED",
      })
    },
  )

  it("rejects dangling symlinks instead of silently treating them as missing", async () => {
    const directory = await temp()
    const link = join(directory, "dangling")
    await symlink(join(directory, "absent"), link, "junction")
    await expect(physicalPath(link)).rejects.toMatchObject({
      code: "PATH_RESOLUTION_FAILED",
    })
    await expect(physicalPath(join(link, "project"))).rejects.toMatchObject({
      code: "PATH_RESOLUTION_FAILED",
    })
  })

  it("rejects filesystem errors instead of disabling protection", async () => {
    const directory = await temp()
    const file = join(directory, "file")
    await writeFile(file, "John Doe")
    await expect(physicalPath(join(file, "project"))).rejects.toMatchObject({
      code: "PATH_RESOLUTION_FAILED",
    })
  })

  it("rejects symlink loops", async () => {
    const directory = await temp()
    const first = join(directory, "first")
    const second = join(directory, "second")
    await symlink(second, first, "junction")
    await symlink(first, second, "junction")
    await expect(physicalPath(first)).rejects.toMatchObject({
      code: "PATH_RESOLUTION_FAILED",
    })
  })

  it("does not swallow permission errors from ancestor inspection", async () => {
    // Deterministic on Windows and when tests run with elevated privileges.
    const spy = vi
      .mocked(lstat)
      .mockRejectedValueOnce(
        Object.assign(new Error("denied"), { code: "EACCES" }),
      )
    try {
      await expect(
        physicalPath(join(await temp(), "missing")),
      ).rejects.toMatchObject({
        code: "PATH_RESOLUTION_FAILED",
        cause: { code: "EACCES" },
      })
    } finally {
      spy.mockRestore()
    }
  })

  it("refuses a missing filesystem root rather than looping", async () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" })
    vi.mocked(realpath).mockRejectedValueOnce(error)
    vi.mocked(lstat).mockRejectedValueOnce(error)
    await expect(
      physicalPath(parse(resolve("/work")).root),
    ).rejects.toMatchObject({ code: "PATH_RESOLUTION_FAILED" })
  })
})
