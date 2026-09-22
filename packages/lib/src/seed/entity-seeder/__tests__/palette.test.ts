// packages/lib/src/seed/entity-seeder/__tests__/palette.test.ts
//
// The guard for plans/icons/entity-def-palette.md. Tests 1-2 are the ones that would have
// caught the six entity defs set to ids ICON_COLORS never had (§1.2); test 3 is the one that
// keeps SYSTEM_ENTITIES and ModelTypeMeta from drifting apart again (§1.1).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModelTypeMeta } from '@auxx/database/enums'
import { ENTITY_COLORS } from '@auxx/types/entity-color'
import { describe, expect, it } from 'vitest'
import { OPTION_COLORS } from '../../../custom-fields/client'
import { SYSTEM_ENTITIES } from '../constants'

/**
 * `icon-data.ts` is read off disk, not imported: `@auxx/lib` has no `@auxx/ui` dependency
 * and that module pulls `lucide-react` behind it. The ids are a flat literal, so a regex is
 * enough — and keeping the check here is what matters, next to the icons it guards.
 * The `ICON_COLORS`-side assertion lives in `packages/ui/src/components/icons.test.ts`.
 */
const ICON_IDS: ReadonlySet<string> = new Set(
  [
    ...readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../ui/src/components/icon-data.ts'
      ),
      'utf8'
    ).matchAll(/\{ id: '([a-z0-9-]+)',/g),
  ].map((m) => m[1] as string)
)

/** §2 — colour is the accounting axis. The one table this suite checks everything against. */
const CATEGORY_COLOR = {
  sell: 'green',
  buy: 'red',
  goods: 'teal',
  cash: 'blue',
  ledger: 'gray',
  tax: 'amber',
  people: 'purple',
  support: 'indigo',
  metadata: 'gray',
} as const

const CATEGORY: Record<string, keyof typeof CATEGORY_COLOR> = {
  quote: 'sell',
  order: 'sell',
  line_item: 'sell',
  invoice: 'sell',
  credit_memo: 'sell',
  credit_memo_line: 'sell',
  credit_memo_application: 'sell',
  fulfillment: 'sell',
  fulfillment_line: 'sell',
  return: 'sell',
  return_line: 'sell',
  return_part_line: 'sell',
  purchase_order: 'buy',
  purchase_order_line: 'buy',
  vendor_bill: 'buy',
  vendor_bill_line: 'buy',
  vendor_credit: 'buy',
  vendor_credit_line: 'buy',
  vendor_credit_application: 'buy',
  product: 'goods',
  part: 'goods',
  vendor_part: 'goods',
  subpart: 'goods',
  catalog_item: 'goods',
  catalog_group: 'goods',
  stock_movement: 'goods',
  build: 'goods',
  shipment: 'goods',
  parcel: 'goods',
  bank_account: 'cash',
  bank_transaction: 'cash',
  bank_rule: 'cash',
  bank_deposit: 'cash',
  payout: 'cash',
  payment_gateway: 'cash',
  customer_transaction: 'cash',
  processor_balance_entry: 'cash',
  gl_account: 'ledger',
  journal_entry: 'ledger',
  journal_entry_line: 'ledger',
  tax_line: 'tax',
  tariff_code: 'tax',
  tariff_rate: 'tax',
  contact: 'people',
  company: 'people',
  entity_group: 'people',
  ticket: 'support',
  thread: 'support',
  inbox: 'support',
  personal_inbox: 'support',
  meeting: 'support',
  article: 'support',
  work_order: 'support',
  service_request: 'support',
  tag: 'metadata',
  signature: 'metadata',
}

describe('entity definition palette', () => {
  it('only uses colours the renderer has (§1.2)', () => {
    // `getIconColor` falls back to gray rather than throwing, so a bad id is invisible in
    // production — this assertion is the only thing that makes one loud.
    const bad = SYSTEM_ENTITIES.filter((e) => !ENTITY_COLORS.includes(e.color)).map(
      (e) => `${e.entityType}=${e.color}`
    )
    expect(bad).toEqual([])
  })

  it('only uses icons the catalog has', () => {
    expect(ICON_IDS.size).toBeGreaterThan(200)
    const bad = SYSTEM_ENTITIES.filter((e) => !ICON_IDS.has(e.icon)).map(
      (e) => `${e.entityType}=${e.icon}`
    )
    expect(bad).toEqual([])
  })

  it('agrees with ModelTypeMeta on every shared type (§1.1)', () => {
    const disagreements: string[] = []
    for (const entity of SYSTEM_ENTITIES) {
      const meta = ModelTypeMeta[entity.entityType as keyof typeof ModelTypeMeta]
      if (!meta) continue
      if (meta.icon !== entity.icon || meta.color !== entity.color) {
        disagreements.push(
          `${entity.entityType}: def=${entity.icon}/${entity.color} meta=${meta.icon}/${meta.color}`
        )
      }
    }
    expect(disagreements).toEqual([])
  })

  it('gives every entity its category colour (§2)', () => {
    const wrong: string[] = []
    for (const entity of SYSTEM_ENTITIES) {
      const category = CATEGORY[entity.entityType]
      if (!category) {
        wrong.push(`${entity.entityType}: no category — add it to the fixture`)
        continue
      }
      const expected = CATEGORY_COLOR[category]
      if (entity.color !== expected) {
        wrong.push(`${entity.entityType}: ${category} should be ${expected}, is ${entity.color}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('has no orange left', () => {
    expect(SYSTEM_ENTITIES.filter((e) => e.color === 'orange')).toEqual([])
  })

  it('gives OPTION_COLORS the same twelve ids, in order (§1.3)', () => {
    // Half of the assertion that keeps `forest`/`emerald` from diverging again; the
    // `ICON_COLORS` half is in `packages/ui/src/components/icons.test.ts`.
    expect(OPTION_COLORS.map((c) => c.id)).toEqual([...ENTITY_COLORS])
  })

  it('gives every option colour a real hex (getOptionColorHex feeds raw CSS)', () => {
    for (const color of OPTION_COLORS) {
      expect(color.hex, color.id).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
