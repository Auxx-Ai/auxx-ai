// packages/lib/src/accounting/ledger/post/__tests__/policy.test.ts
//
// brief 28 section 9, tests 1 to 3. The policy is the one declared table the
// Posting page, the guides and the regime all render from, so three things are
// pinned here:
//
//   1. every posting type has a policy, by EXACT-set equality (the shape
//      `types.test.ts` uses for `POSTING_TYPES` against the pgEnum);
//   2. `ENABLED_POSTING_TYPES`, now derived from the policy, equals the literal
//      `regime.ts` held before unit 1 plus `recurring_journal`, byte for byte -
//      the pre-unit-1 list is what let the unit merge without a drive, and
//      `recurring_journal` was appended on 2026-09-14 by decision 5 of §10;
//   3. every type the completeness banner renders as off renders the SAME
//      sentence it did before the table was derived.
//
// The literals below are deliberately hardcoded copies, not imports. Importing
// them would make the assertion tautological.

import { describe, expect, it } from 'vitest'
import { DISABLED_POSTING_TYPE_SENTENCES } from '../../../reports/completeness'
import { ACCOUNT_ROLES } from '../../builders/entry'
import {
  ENABLED_POSTING_TYPES,
  EXPORT_ROUTE_BY_POSTING_TYPE,
  findWriterConflicts,
  SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
} from '../../roles/regime'
import { POSTING_TYPES, type PostingType } from '../../types'
import { LEDGER_WIDE_SETTING_KEYS, POSTING_POLICIES, POSTING_POLICY } from '../policy'

/**
 * `regime.ts`'s `ENABLED_POSTING_TYPES` as it stood on 2026-09-14 before unit
 * 1, then `recurring_journal`, enabled the same day (§10 decision 5). Declared
 * in the order the ledger switched them on, which is the order the policy must
 * declare them in.
 */
const ENABLED_TYPES_PINNED: readonly PostingType[] = [
  'inventory_movement',
  'manual_journal',
  'opening_balance',
  'bank_deposit',
  'fulfillment',
  'payment',
  // 92: a vendor payment is its own type, declared beside the customer payment
  // it was split off; the vendor refund likewise sits beside the refund.
  'vendor_payment',
  // TARGET §5 gave a refund its own type, declared beside the payment it used
  // to borrow. MIGRATION step 2.
  'refund',
  'vendor_refund',
  'payout',
  'write_off',
  'bank_transaction',
  'invoice_issued',
  'credit_memo',
  // 71 §5 U7. Declared beside the vendor bill, whose entry it is with the sides
  // flipped, so it lands here rather than at the end of the block.
  'vendor_credit',
  'recurring_journal',
  // 73 D3: the ONE bill type, of either kind, posted by the Post action. It is
  // declared last because it was switched on last.
  'vendor_bill',
  // 74 D4, switched on after it.
  'landed_cost_clear',
]

/**
 * `completeness.ts`'s sentence for every type that was NOT enabled on
 * 2026-09-14, exactly as the banner rendered it. `provider_sync` is absent on
 * purpose: `NEVER_CLOSE_EMITTED` subtracts it before a sentence is read.
 * `recurring_journal` had no hand-written sentence and fell through to the
 * generic `"<type>" posting is off.` fallback; it is enabled now and its
 * sentence is pinned separately below.
 */
const DISABLED_SENTENCES_BEFORE_UNIT_1: Partial<Record<PostingType, string>> = {
  month_end_deferral: 'Month-end deferral posting is off.',
  month_end_reversal: 'Month-end reversal posting is off.',
}

describe('every posting type has a policy', () => {
  it('POSTING_POLICY keys and POSTING_TYPES hold exactly the same set', () => {
    expect(Object.keys(POSTING_POLICY).sort()).toEqual([...POSTING_TYPES].sort())
  })

  it("every record's `type` is its own key", () => {
    for (const [key, policy] of Object.entries(POSTING_POLICY)) {
      expect(policy.type).toBe(key)
    }
  })

  it('POSTING_POLICIES is the same records in declaration order', () => {
    expect(POSTING_POLICIES.map((policy) => policy.type)).toEqual(Object.keys(POSTING_POLICY))
  })
})

describe('the derived regime reads exactly as the literal did', () => {
  it('ENABLED_POSTING_TYPES equals the pre-unit-1 list plus recurring_journal and refund, byte for byte', () => {
    expect([...ENABLED_POSTING_TYPES]).toEqual([...ENABLED_TYPES_PINNED])
  })

  // Decision 5. The daily job wrote drafts of this type while the banner called
  // it off; enabling it must not put a second writer on any inventory account.
  it('`recurring_journal` is enabled and drives no single-writer role', () => {
    expect(ENABLED_POSTING_TYPES).toContain('recurring_journal')
    expect(POSTING_POLICY.recurring_journal.singleWriterRoles).toEqual([])
    expect(findWriterConflicts()).toEqual([])
  })

  it('`opening_balance` and `provider_sync` route none, and every other type routes journal', () => {
    for (const type of POSTING_TYPES) {
      const expected = type === 'opening_balance' || type === 'provider_sync' ? 'none' : 'journal'
      expect(EXPORT_ROUTE_BY_POSTING_TYPE[type], type).toBe(expected)
    }
  })

  it('`inventory_movement` is the ONE declared writer of the inventory roles', () => {
    expect([...SINGLE_WRITER_ROLES_BY_POSTING_TYPE.inventory_movement].sort()).toEqual(
      [
        ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
        ACCOUNT_ROLES.INVENTORY_WIP,
        ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
      ].sort()
    )
    for (const type of POSTING_TYPES) {
      if (type === 'inventory_movement') continue
      expect(SINGLE_WRITER_ROLES_BY_POSTING_TYPE[type], type).toEqual([])
    }
  })
})

describe('the completeness banner renders the same sentences before and after', () => {
  it('every type that was disabled before unit 1 keeps its sentence, word for word', () => {
    for (const [type, sentence] of Object.entries(DISABLED_SENTENCES_BEFORE_UNIT_1)) {
      expect(DISABLED_POSTING_TYPE_SENTENCES[type as PostingType], type).toBe(sentence)
      expect(POSTING_POLICY[type as PostingType].disabledSentence, type).toBe(sentence)
    }
  })

  it('every type that was disabled before unit 1 is still disabled, except recurring_journal', () => {
    const enabled = new Set(ENABLED_POSTING_TYPES)
    for (const type of Object.keys(DISABLED_SENTENCES_BEFORE_UNIT_1)) {
      expect(enabled.has(type as PostingType), type).toBe(false)
    }
    expect(enabled.has('recurring_journal')).toBe(true)
    expect(enabled.has('provider_sync')).toBe(false)
  })

  // `recurring_journal` had no sentence and rendered the generic fallback. The
  // policy gives it a real OFF sentence even though it is enabled now: the
  // sentence is the pair of `sentence`, and the page's tooltip reads it.
  it('`recurring_journal` no longer falls through to the generic fallback', () => {
    expect(DISABLED_POSTING_TYPE_SENTENCES.recurring_journal).toBeDefined()
    expect(DISABLED_POSTING_TYPE_SENTENCES.recurring_journal).not.toBe(
      '"recurring_journal" posting is off.'
    )
  })
})

describe('every policy is a complete declaration', () => {
  it('has a non-empty label, ON sentence and OFF sentence', () => {
    for (const policy of POSTING_POLICIES) {
      expect(policy.label.trim().length, policy.type).toBeGreaterThan(0)
      expect(policy.sentence.trim().length, policy.type).toBeGreaterThan(0)
      expect(policy.disabledSentence.trim().length, policy.type).toBeGreaterThan(0)
    }
  })

  it('has a trigger, and a `never` trigger is the only one with no template', () => {
    for (const policy of POSTING_POLICIES) {
      expect(policy.trigger, policy.type).toBeDefined()
      if (policy.trigger.kind === 'never') {
        expect(policy.enabled, policy.type).toBe(false)
      } else {
        expect(policy.template.length, policy.type).toBeGreaterThan(0)
      }
    }
  })

  it('a scheduled trigger carries a five-field cron in UTC', () => {
    for (const policy of POSTING_POLICIES) {
      if (policy.trigger.kind !== 'schedule') continue
      expect(policy.trigger.cron.trim().split(/\s+/), policy.type).toHaveLength(5)
      expect(policy.trigger.tz, policy.type).toBe('UTC')
      expect(policy.trigger.description.trim().length, policy.type).toBeGreaterThan(0)
    }
  })

  it('a template line names a real account role or `by id`, and every line has both sides somewhere', () => {
    const roles = new Set<string>(Object.values(ACCOUNT_ROLES))
    for (const policy of POSTING_POLICIES) {
      if (policy.template.length === 0) continue
      const sides = new Set(policy.template.map((line) => line.side))
      expect(sides.has('debit'), policy.type).toBe(true)
      expect(sides.has('credit'), policy.type).toBe(true)
      for (const line of policy.template) {
        expect(line.role === 'by id' || roles.has(line.role), `${policy.type}: ${line.role}`).toBe(
          true
        )
        expect(line.what.trim().length, policy.type).toBeGreaterThan(0)
      }
    }
  })

  it('every parameter has a name, a value and a sentence', () => {
    for (const policy of POSTING_POLICIES) {
      for (const parameter of policy.parameters) {
        expect(parameter.name.trim().length, policy.type).toBeGreaterThan(0)
        expect(parameter.value.trim().length, policy.type).toBeGreaterThan(0)
        expect(parameter.sentence.trim().length, policy.type).toBeGreaterThan(0)
      }
    }
  })

  it('does not repeat a ledger-wide setting key, except where the key dates the entry', () => {
    const shared = new Set(LEDGER_WIDE_SETTING_KEYS)
    for (const policy of POSTING_POLICIES) {
      if (policy.type === 'opening_balance') continue
      for (const key of policy.settings) {
        expect(shared.has(key), `${policy.type}: ${key}`).toBe(false)
      }
    }
  })

  it('single-writer roles are only ever inventory roles', () => {
    const inventory = new Set<string>([
      ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
      ACCOUNT_ROLES.INVENTORY_WIP,
      ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
    ])
    for (const policy of POSTING_POLICIES) {
      for (const role of policy.singleWriterRoles) {
        expect(inventory.has(role), `${policy.type}: ${role}`).toBe(true)
      }
    }
  })
})

// Decision 7 of §10: the record links and the setting row copy moved off the
// web app's UI model and onto the policy. A copy entry for a key the policy does
// not list would render nowhere and rot; a record link that is not an in-app
// path would leave the app.
describe('records and setting copy are declared on the policy they belong to', () => {
  it('every settingCopy key is one of that policy`s settings, with a title', () => {
    for (const policy of POSTING_POLICIES) {
      const settings = new Set(policy.settings)
      for (const [key, copy] of Object.entries(policy.settingCopy ?? {})) {
        expect(settings.has(key), `${policy.type}: ${key}`).toBe(true)
        expect(copy.title.trim().length, `${policy.type}: ${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('every record link is labelled and points inside the app', () => {
    for (const policy of POSTING_POLICIES) {
      for (const record of policy.records ?? []) {
        expect(record.label.trim().length, policy.type).toBeGreaterThan(0)
        expect(record.href.startsWith('/app/'), `${policy.type}: ${record.href}`).toBe(true)
      }
    }
  })

  it('the two autoPost rows describe what off does', () => {
    expect(
      POSTING_POLICY.fulfillment.settingCopy?.['accounting.autoPost.fulfillment']?.description
    ).toMatch(/drafts on the ledger/)
    expect(
      POSTING_POLICY.credit_memo.settingCopy?.['accounting.autoPost.creditMemo']?.description
    ).toMatch(/drafts on the ledger/)
  })
})
