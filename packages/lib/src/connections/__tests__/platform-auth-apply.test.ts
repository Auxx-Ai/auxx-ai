// packages/lib/src/connections/__tests__/platform-auth-apply.test.ts
// Every platform provider's `authApply` must reference a placeholder that can actually
// resolve at runtime. This iterates the registry rather than listing providers, so a def
// added later fails here without anyone remembering the rule.
//
// The rule exists because the failure is SILENT. `applyAuth` interpolates `{value}` from
// `secretValue(secrets)` — `secrets.accessToken || secrets.secret` — with a single fallback
// to a connection variable literally named `value`. A `secret` connection whose variable
// carries any other name (`apiKey`, …) files it under `secrets.fields.apiKey`, so `{value}`
// renders EMPTY and the request goes out with `Authorization: Bearer ` and 401s. That is the
// bug that made the Quo contacts data-connector's test-fetch fail while the SMS channel on
// the same credential kept working (it hand-rolls its own header and never calls `applyAuth`).

import { extractPlaceholders } from '@auxx/credentials/connections'
import type { AuthApply, AuthInsertion } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { PLATFORM_PROVIDER_DEFS } from '../providers/defs'

/** The insertions a spec applies, single or multi. */
function insertionsOf(spec: AuthApply): AuthInsertion[] {
  return 'insertions' in spec ? spec.insertions : [spec]
}

/** Every `{placeholder}` an insertion interpolates, across its name and format. */
function placeholdersOf(ins: AuthInsertion): string[] {
  const templates: string[] = []
  if (ins.in === 'header' || ins.in === 'query') {
    templates.push(ins.name)
    if (ins.format) templates.push(ins.format)
  }
  return templates.flatMap(extractPlaceholders)
}

/**
 * `{value}` resolves to a real token only for connection types that mint one. For a
 * `secret` connection it is empty unless a variable is literally named `value`.
 */
function valueResolves(def: (typeof PLATFORM_PROVIDER_DEFS)[number]): boolean {
  if (def.connectionType !== 'secret') return true
  return (def.connectionVariables ?? []).some((v) => v.key === 'value')
}

describe('platform provider authApply placeholders', () => {
  const withAuth = PLATFORM_PROVIDER_DEFS.filter((d) => d.authApply)

  it('covers a meaningful slice of the registry', () => {
    expect(withAuth.length).toBeGreaterThan(10)
  })

  it.each(
    withAuth.map((d) => [d.providerKey, d] as const)
  )('%s resolves every placeholder it interpolates', (_key, def) => {
    const declared = new Set((def.connectionVariables ?? []).map((v) => v.key))
    for (const ins of insertionsOf(def.authApply as AuthApply)) {
      for (const placeholder of placeholdersOf(ins)) {
        if (placeholder === 'value') {
          expect(
            valueResolves(def),
            `${def.providerKey}: authApply interpolates {value}, but a 'secret' connection ` +
              `only resolves it from a variable named 'value'. Its variables are ` +
              `[${[...declared].join(', ')}] — reference one of those instead.`
          ).toBe(true)
        } else {
          expect(
            declared.has(placeholder),
            `${def.providerKey}: authApply interpolates {${placeholder}}, which is not a ` +
              `declared connection variable ([${[...declared].join(', ')}]).`
          ).toBe(true)
        }
      }
    }
  })
})
