// packages/lib/src/identity/link-template.ts

import { BadRequestError } from '../errors'

/**
 * One variable in an identity field's page-URL template. See
 * plans/data-connectors/external-record-link-plan.md §2.
 */
export type LinkVariable =
  | { kind: 'externalId' }
  | { kind: 'connection'; key: string }
  | { kind: 'via'; relationship: string; appFieldKey: string }
  | { kind: 'field'; key: string }

const IDENT = '[A-Za-z_][A-Za-z0-9_]*'

/**
 * The whole grammar, in one pattern. `packages/sdk/src/root/fields/link-template.ts`
 * holds a byte-identical copy (the SDK has no workspace deps) — change both.
 */
export const LINK_VARIABLE = new RegExp(
  `\\{(?:externalId|connection\\.${IDENT}|via\\.${IDENT}\\.${IDENT}|field\\.${IDENT})\\}`
)

/** Every `{...}` group, valid or not, so an unknown one can be rejected rather than left literal. */
const BRACED = /\{[^}]*\}/g

const EXACT = new RegExp(`^${LINK_VARIABLE.source}$`)

/**
 * Validate a template and return its variables in source order. Throws
 * `BadRequestError` on a bad prefix or any `{...}` outside the four kinds —
 * catalog extraction and resolution share this so the two cannot drift.
 */
export function parseLinkTemplate(template: string): LinkVariable[] {
  if (!template.startsWith('https://') && !template.startsWith('{field.')) {
    throw new BadRequestError(`Link template must start with "https://" or "{field.": ${template}`)
  }
  const variables: LinkVariable[] = []
  for (const match of template.matchAll(BRACED)) {
    const token = match[0]
    if (!EXACT.test(token)) {
      throw new BadRequestError(`Unsupported link variable ${token} in ${template}`)
    }
    variables.push(toVariable(token.slice(1, -1)))
  }
  return variables
}

/**
 * Substitute every variable through `resolve`. A variable that resolves to null
 * or the empty string yields no link at all — never a half URL.
 */
export function interpolateLinkTemplate(
  template: string,
  resolve: (variable: LinkVariable) => string | null
): string | null {
  const variables = parseLinkTemplate(template)
  let index = 0
  let missing = false
  // `replace` visits matches in the same order `matchAll` produced `variables`.
  const href = template.replace(BRACED, () => {
    const variable = variables[index++]
    const value = variable ? resolve(variable) : null
    if (value === null || value === '') {
      missing = true
      return ''
    }
    return value
  })
  return missing ? null : href
}

function toVariable(inner: string): LinkVariable {
  if (inner === 'externalId') return { kind: 'externalId' }
  const [kind, first, second] = inner.split('.')
  if (kind === 'connection') return { kind: 'connection', key: first as string }
  if (kind === 'field') return { kind: 'field', key: first as string }
  return { kind: 'via', relationship: first as string, appFieldKey: second as string }
}
