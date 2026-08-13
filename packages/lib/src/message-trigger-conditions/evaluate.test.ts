// packages/lib/src/message-trigger-conditions/evaluate.test.ts

import { ParticipantRole } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import type { Condition, ConditionGroup } from '../conditions/types'
import { evaluateMessageConditions } from './evaluate'
import type { MessageConditionInput } from './types'

function condition(overrides: Partial<Condition> & Pick<Condition, 'fieldId'>): Condition {
  return {
    id: overrides.id ?? `c-${String(overrides.fieldId)}`,
    operator: 'is',
    value: '',
    ...overrides,
  } as Condition
}

function group(conditions: Condition[], logicalOperator: 'AND' | 'OR' = 'AND'): ConditionGroup {
  return { id: 'g1', conditions, logicalOperator }
}

const message = (overrides: Partial<MessageConditionInput> = {}): MessageConditionInput => ({
  from: { identifier: 'priya@example.com', name: 'Priya' },
  participants: [
    { role: ParticipantRole.TO, participant: { identifier: 'support@shop.com', name: 'Support' } },
    { role: ParticipantRole.CC, participant: { identifier: 'boss@shop.com', name: 'Boss' } },
  ],
  subject: 'Where is my order?',
  textPlain: 'It never arrived.',
  textHtml: '<p>It never arrived.</p>',
  hasAttachments: false,
  ...overrides,
})

describe('evaluateMessageConditions', () => {
  it('matches everything when there are no conditions', () => {
    expect(evaluateMessageConditions(message(), undefined).matched).toBe(true)
    expect(evaluateMessageConditions(message(), []).matched).toBe(true)
  })

  it('matches on `from`', () => {
    const groups = [
      group([condition({ fieldId: 'from', operator: 'is', value: 'priya@example.com' })]),
    ]
    expect(evaluateMessageConditions(message(), groups).matched).toBe(true)

    const missGroups = [
      group([condition({ fieldId: 'from', operator: 'is', value: 'someone-else@example.com' })]),
    ]
    expect(evaluateMessageConditions(message(), missGroups).matched).toBe(false)
  })

  it('matches on `to` by fanning out over every TO participant (CC is excluded)', () => {
    const groups = [
      group([condition({ fieldId: 'to', operator: 'is', value: 'support@shop.com' })]),
    ]
    expect(evaluateMessageConditions(message(), groups).matched).toBe(true)

    const ccGroups = [group([condition({ fieldId: 'to', operator: 'is', value: 'boss@shop.com' })])]
    expect(evaluateMessageConditions(message(), ccGroups).matched).toBe(false)
  })

  it('matches on `subject` contains', () => {
    const groups = [
      group([condition({ fieldId: 'subject', operator: 'contains', value: 'order' })]),
    ]
    expect(evaluateMessageConditions(message(), groups).matched).toBe(true)
  })

  it('matches on `body`, falling back from textPlain to textHtml', () => {
    const groups = [
      group([condition({ fieldId: 'body', operator: 'contains', value: 'never arrived' })]),
    ]
    expect(evaluateMessageConditions(message(), groups).matched).toBe(true)

    const htmlOnly = message({ textPlain: null })
    expect(
      evaluateMessageConditions(htmlOnly, [
        group([condition({ fieldId: 'body', operator: 'contains', value: 'never arrived' })]),
      ]).matched
    ).toBe(true)
  })

  it('matches on `hasAttachments`', () => {
    const groups = [group([condition({ fieldId: 'hasAttachments', operator: 'is', value: true })])]
    expect(evaluateMessageConditions(message(), groups).matched).toBe(false)
    expect(evaluateMessageConditions(message({ hasAttachments: true }), groups).matched).toBe(true)
  })

  it('ANDs multiple conditions in a group', () => {
    const groups = [
      group([
        condition({ fieldId: 'subject', operator: 'contains', value: 'order' }),
        condition({ id: 'c2', fieldId: 'hasAttachments', operator: 'is', value: true }),
      ]),
    ]
    expect(evaluateMessageConditions(message(), groups).matched).toBe(false)
    expect(evaluateMessageConditions(message({ hasAttachments: true }), groups).matched).toBe(true)
  })

  it('fails closed on an unrecognised operator — non-match, not a silent pass', () => {
    const groups = [
      group([condition({ fieldId: 'subject', operator: 'is_the_moon' as never, value: 'x' })]),
    ]
    const result = evaluateMessageConditions(message(), groups)
    expect(result.matched).toBe(false)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({ reason: 'unknown-operator', fieldId: 'subject' })
  })

  it('fails closed on an unknown field id — resolves undefined, matches nothing', () => {
    const groups = [group([condition({ fieldId: 'channel', operator: 'is', value: 'outlook' })])]
    expect(evaluateMessageConditions(message(), groups).matched).toBe(false)
  })
})
