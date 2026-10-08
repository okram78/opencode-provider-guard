import { isAbsolute } from "node:path"
import { ProviderGuardError } from "./errors.js"

export interface GuardRule {
  readonly root: string
  readonly allowProviders: readonly string[]
}

export interface GuardOptions {
  readonly rules: readonly GuardRule[]
}

function invalid(message: string): never {
  throw new ProviderGuardError("INVALID_CONFIG", message)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function keys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      invalid(`${label}: unknown option ${JSON.stringify(key)}.`)
  }
}

/** Reject typos and malformed rules instead of silently weakening protection. */
export function parseOptions(input: unknown): GuardOptions {
  const options = record(input, "options")
  keys(options, ["rules"], "options")
  if (!Array.isArray(options.rules) || options.rules.length === 0) {
    invalid("options.rules must be a non-empty array.")
  }

  const rules = options.rules.map((input: unknown, index: number) => {
    const label = `rules[${index}]`
    const rule = record(input, label)
    keys(rule, ["root", "allowProviders"], label)
    if (
      typeof rule.root !== "string" ||
      rule.root.length === 0 ||
      rule.root !== rule.root.trim() ||
      /[\0*?]/u.test(rule.root) ||
      !(
        isAbsolute(rule.root) ||
        rule.root === "~" ||
        rule.root.startsWith("~/")
      )
    ) {
      invalid(
        `${label}.root must be an absolute path or a ~/ path, without wildcards or surrounding whitespace.`,
      )
    }
    if (!Array.isArray(rule.allowProviders)) {
      invalid(
        `${label}.allowProviders must be an array of exact provider IDs (an empty array denies all providers).`,
      )
    }
    const providers = rule.allowProviders.map((provider: unknown) => {
      if (
        typeof provider !== "string" ||
        provider !== provider.trim() ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(provider)
      ) {
        invalid(
          `${label}.allowProviders must contain exact provider IDs, not model references or patterns.`,
        )
      }
      return provider
    })
    return Object.freeze({
      root: rule.root,
      allowProviders: Object.freeze([...new Set(providers)]),
    })
  })
  return Object.freeze({ rules: Object.freeze(rules) })
}
