import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach } from "vitest"

/** Each test owns only its newly created fixture directory. */
export function temporaryDirectories(): () => Promise<string> {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })
  return async () => {
    const directory = await mkdtemp(join(tmpdir(), "provider-guard-john-doe-"))
    directories.push(directory)
    return directory
  }
}
