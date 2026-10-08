import { parseOptions, type GuardRule } from "./config.js"
import { containsPath, expandHome, pathAliases } from "./paths.js"

export interface GuardPolicy {
  readonly matchedRoots: readonly string[]
  /** undefined means unrestricted; an empty list means deny all. */
  readonly allowProviders: readonly string[] | undefined
}

export function permits(policy: GuardPolicy, providerID: string): boolean {
  return (
    policy.allowProviders === undefined ||
    policy.allowProviders.includes(providerID)
  )
}

/** All matching rules intersect: a nested rule cannot relax its parent. */
export class PolicyEngine {
  readonly #rules: readonly GuardRule[]

  constructor(options: unknown) {
    this.#rules = parseOptions(options).rules.map((rule) => ({
      ...rule,
      root: expandHome(rule.root),
    }))
  }

  async evaluate(directories: readonly string[]): Promise<GuardPolicy> {
    // No cached filesystem/session state: moves and changed symlink targets are
    // re-evaluated on the next request, rather than on the next plugin reload.
    const paths = (await Promise.all(directories.map(pathAliases))).flat()
    const matches = await Promise.all(
      this.#rules.map(async (rule) => {
        const roots = await pathAliases(rule.root)
        return roots.some((root) =>
          paths.some((directory) => containsPath(root, directory)),
        )
          ? rule
          : undefined
      }),
    )
    const rules = matches.filter((rule) => rule !== undefined)
    const first = rules[0]
    return {
      matchedRoots: rules.map((rule) => rule.root),
      allowProviders: first?.allowProviders.filter((provider) =>
        rules.every((rule) => rule.allowProviders.includes(provider)),
      ),
    }
  }
}
