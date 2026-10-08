# OpenCode Provider Guard

Restricts which providers OpenCode can use in selected directories. Useful for
keeping personal, pay-as-you-go providers out of work projects. It blocks
disallowed providers; it never switches models, accounts, or providers for you.

## Compatibility

- OpenCode **V2**; tested against `@opencode/plugin` 2.0.24.
- Bun 1.4.2 for development. Node.js 22.12+ is required for Node-based use; the
  published ESM also works with Bun.
- This is an initial release candidate. The package is not automatically
  activated, and the npm package name/version below are not a claim of publication.

## Build and enable

```sh
bun install --frozen-lockfile
bun run check
```

To enable the plugin, add it to your **global** OpenCode config
(`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-provider-guard/dist",
      "options": {
        "rules": [
          {
            "root": "~/projects/work",
            "allowProviders": ["github-copilot"],
          },
        ],
      },
    },
  ],
}
```

Use a global entry so the guard loads in every project. Preserve other config
settings. After publication, the local path can be replaced with
`opencode-provider-guard@0.1.0`.

## Rules

- `root` is an absolute path or `~`/`~/...`; it covers the directory and all
  descendants. Globs, relative paths, and environment-variable expansion are not
  supported.
- `allowProviders` contains exact, case-sensitive provider IDs (not model IDs).
  An empty list denies all providers.
- Overlapping rules are intersected, so a nested rule can narrow but never relax
  an outer rule. No matching rule means no restriction.
- Both lexical and resolved paths are checked, including symlink targets. Invalid
  paths and filesystem errors fail closed.

## Development

```sh
bun install --frozen-lockfile
bun run check
npm pack --dry-run
```

## License

[MIT](LICENSE).
