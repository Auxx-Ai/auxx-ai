// packages/sdk/src/root/fields/link-template.ts

/**
 * One variable inside an identity field's `link` template. See
 * plans/data-connectors/external-record-link-plan.md §2.
 */
export type LinkVariable =
  | { kind: 'externalId' }
  | { kind: 'connection'; key: string }
  | { kind: 'via'; relationship: string; appFieldKey: string }
  | { kind: 'field'; key: string }

const IDENT = '[A-Za-z_][A-Za-z0-9_]*'

/**
 * The whole grammar, in one pattern. `packages/lib/src/identity/link-template.ts`
 * holds a byte-identical copy (the SDK has no workspace deps) — change both.
 */
export const LINK_VARIABLE = new RegExp(
  `\\{(?:externalId|connection\\.${IDENT}|via\\.${IDENT}\\.${IDENT}|field\\.${IDENT})\\}`
)

/** Every `{...}` group, valid or not, so an unknown one can be rejected rather than left literal. */
const BRACED = /\{[^}]*\}/g

const EXACT = new RegExp(`^${LINK_VARIABLE.source}$`)

/**
 * Validate a template and return its variables in source order. Throws naming
 * the offending token — the authoring-time guard, mirrored at resolve time by
 * the lib copy.
 */
export function parseLinkTemplate(template: string): LinkVariable[] {
  if (!template.startsWith('https://') && !template.startsWith('{field.')) {
    throw new Error(`Link template must start with "https://" or "{field.": ${template}`)
  }
  const variables: LinkVariable[] = []
  for (const match of template.matchAll(BRACED)) {
    const token = match[0]
    if (!EXACT.test(token)) {
      throw new Error(`Unsupported link variable ${token} in ${template}`)
    }
    variables.push(toLinkVariable(token.slice(1, -1)))
  }
  return variables
}

/** `body` has already matched `LINK_VARIABLE`, so every part is present. */
function toLinkVariable(body: string): LinkVariable {
  const parts = body.split('.')
  const head = parts[0] as string
  if (head === 'externalId') return { kind: 'externalId' }
  if (head === 'connection') return { kind: 'connection', key: parts[1] as string }
  if (head === 'via') {
    return { kind: 'via', relationship: parts[1] as string, appFieldKey: parts[2] as string }
  }
  return { kind: 'field', key: parts[1] as string }
}
