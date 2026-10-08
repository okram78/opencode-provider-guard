import { lstat, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { ProviderGuardError } from "./errors.js"

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

export function expandHome(value: string, home = homedir()): string {
  if (value === "~") return home
  if (value.startsWith("~/")) return `${home}${sep}${value.slice(2)}`
  return value
}

/** Component-aware containment: /work never matches /work-personal. */
export function containsPath(root: string, directory: string): boolean {
  const suffix = relative(root, directory)
  return (
    suffix === "" ||
    (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
  )
}

/**
 * Resolve symlinks, including existing ancestors of a not-yet-created path.
 * Permission errors, dangling links and symlink loops are not treated as misses.
 */
export async function physicalPath(value: string): Promise<string> {
  if (!isAbsolute(value) || value.includes("\0")) {
    throw new ProviderGuardError(
      "PATH_RESOLUTION_FAILED",
      "Expected an absolute filesystem path.",
    )
  }
  let current = value
  const segments: string[] = []
  try {
    for (;;) {
      try {
        return resolve(await realpath(current), ...segments)
      } catch (error) {
        if (!missing(error)) throw error
        // realpath reports ENOENT for dangling links too. Do not walk past one.
        const info = await lstat(current).catch((statError: unknown) => {
          if (!missing(statError)) throw statError
          return undefined
        })
        if (info?.isSymbolicLink()) throw error
        const parent = dirname(current)
        if (parent === current) throw error
        segments.unshift(relative(parent, current))
        current = parent
      }
    }
  } catch (cause) {
    throw new ProviderGuardError(
      "PATH_RESOLUTION_FAILED",
      `Cannot resolve ${JSON.stringify(value)}; refusing to assume it is unprotected.`,
      { cause },
    )
  }
}

/** Keep both spellings so symlinks cannot remove a lexical restriction. */
export async function pathAliases(value: string): Promise<readonly string[]> {
  return [...new Set([resolve(value), await physicalPath(value)])]
}
