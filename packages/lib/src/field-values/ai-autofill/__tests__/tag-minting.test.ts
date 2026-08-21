// packages/lib/src/field-values/ai-autofill/__tests__/tag-minting.test.ts
//
// Open TAGS is the only phase of AI autofill that writes outside `FieldValue`,
// so the match-before-mint rule is the safety property worth pinning: a label
// that already exists must NEVER produce a second option. These cases exercise
// it through the `dryRun` path, which runs the identical matcher without
// touching the database.

import type { CustomFieldEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { mintOrMatchTagOptions } from '../tag-minting'

const FIELD = {
  id: 'fld_tags',
  name: 'Tags',
  type: 'TAGS',
  options: {
    options: [
      { value: 'opt_ent', label: 'Enterprise' },
      { value: 'opt_smb', label: 'Small Business' },
      { id: 'opt_app_1', value: 'nonprofit', label: 'Nonprofit' },
    ],
  },
} as unknown as CustomFieldEntity

async function match(labels: unknown[]): Promise<string[]> {
  return await mintOrMatchTagOptions({
    organizationId: 'org_1',
    field: FIELD,
    labels,
    dryRun: true,
  })
}

describe('mintOrMatchTagOptions — matching', () => {
  it('collapses case and whitespace variants onto the existing option id', async () => {
    expect(await match(['Enterprise'])).toEqual(['opt_ent'])
    expect(await match(['enterprise'])).toEqual(['opt_ent'])
    expect(await match(['  ENTERPRISE  '])).toEqual(['opt_ent'])
    expect(await match(['Small   Business'])).toEqual(['opt_smb'])
  })

  it('dedupes labels that fold onto the same key within one generation', async () => {
    expect(await match(['Enterprise', 'enterprise', ' Enterprise '])).toEqual(['opt_ent'])
  })

  it('drops blanks and non-strings the model may emit', async () => {
    expect(await match(['', '   ', null, 42, { label: 'x' }, 'Enterprise'])).toEqual(['opt_ent'])
    expect(await match([])).toEqual([])
  })

  it('never mints in dry-run mode — an unmatched label passes through verbatim', async () => {
    expect(await match(['Enterprise', 'Startup'])).toEqual(['opt_ent', 'Startup'])
  })

  it('matches on the LABEL but stores `id ?? value` — the write rule', async () => {
    // `optionKey` prefers an explicit `id`, so an app/connector-provisioned
    // option resolves to its id even though the folded label is what matched.
    expect(await match(['nonprofit'])).toEqual(['opt_app_1'])
  })

  it('preserves the order the model produced', async () => {
    expect(await match(['Small Business', 'Enterprise'])).toEqual(['opt_smb', 'opt_ent'])
  })
})
