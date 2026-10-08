import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import plugin from "@okram78/opencode-provider-guard"

// Import and resolve only. Never call setup or activate the plugin in OpenCode.
assert.equal(plugin.id, "opencode-provider-guard")
assert.equal(typeof plugin.setup, "function")
const entry = Host.resolve({
  directory: fileURLToPath(new URL("..", import.meta.url)),
  name: "@okram78/opencode-provider-guard",
})
assert.ok(entry.server, "OpenCode must resolve the published ESM entrypoint")
const loaded = await Host.load(entry.server)
assert.equal(loaded.default.id, plugin.id)
const localEntry = Host.resolve({
  directory: fileURLToPath(new URL("../dist", import.meta.url)),
})
assert.ok(localEntry.server, "OpenCode must resolve the local plugin directory")
assert.equal((await Host.load(localEntry.server)).default.id, plugin.id)
const schema = JSON.parse(
  await readFile(
    fileURLToPath(
      import.meta.resolve("@okram78/opencode-provider-guard/schema.json"),
    ),
    "utf8",
  ),
)
assert.equal(schema.title, "OpenCode Provider Guard options")
console.log(
  "Built ESM exports, schema and OpenCode V2 entrypoint resolution: OK",
)
