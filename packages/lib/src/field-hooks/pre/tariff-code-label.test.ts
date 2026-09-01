// packages/lib/src/field-hooks/pre/tariff-code-label.test.ts
// The derived `tariff_code_label` (task 30 §8): stamped into the create's own
// value bag, re-stamped when either leg changes, one composer for both.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent, EntityPreCreateEvent } from '../types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  where: vi.fn(),
  setValueWithType: vi.fn(async () => []),
  createFieldValueContext: vi.fn(async (organizationId: string) => ({ organizationId })),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: h.createFieldValueContext,
}))
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))
vi.mock('../../field-values/stored-field-type', () => ({ toFieldType: (stored: string) => stored }))
vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({ from: () => ({ where: () => ({ limit: h.where }) }) }),
  },
  schema: {
    FieldValue: {
      valueText: 'vt',
      optionId: 'oi',
      organizationId: 'o',
      entityId: 'e',
      fieldId: 'f',
    },
  },
}))

import { composeTariffCodeLabel } from '../../bom/vendor-cost'
import { restampTariffCodeLabel, stampTariffCodeLabel } from './tariff-code-label'

const FIELDS = {
  tariff_code_code: { id: 'f_code', type: 'TEXT' },
  tariff_code_country: { id: 'f_country', type: 'SINGLE_SELECT' },
  tariff_code_label: { id: 'f_label', type: 'TEXT' },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockResolvedValue(FIELDS)
  h.where.mockResolvedValue([])
})

function createEvent(values: Record<string, unknown>): EntityPreCreateEvent {
  return {
    entityDefinitionId: 'def_tc',
    entityType: 'tariff_code',
    entitySlug: 'tariff-codes',
    values,
    organizationId: 'org_1',
    userId: 'usr_1',
  }
}

function changeEvent(attribute: string, newValue: unknown): EntityFieldChangeEvent {
  return {
    recordId: 'def_tc:tc_1' as EntityFieldChangeEvent['recordId'],
    entityDefinitionId: 'def_tc',
    entityType: 'tariff_code',
    entitySlug: 'tariff-codes',
    field: { systemAttribute: attribute } as EntityFieldChangeEvent['field'],
    oldValue: null,
    newValue,
    oldDisplay: null,
    newDisplay: null,
    organizationId: 'org_1',
    userId: 'usr_1',
  }
}

describe('composeTariffCodeLabel', () => {
  it('is `{code} {country}`, trimmed, country upper-cased', () => {
    expect(composeTariffCodeLabel(' 8481.80.9005 ', 'cn')).toBe('8481.80.9005 CN')
    expect(composeTariffCodeLabel('8481.80.9005', null)).toBe('8481.80.9005')
  })
})

describe('stampTariffCodeLabel', () => {
  it('adds the label to the create values in place, whatever envelope the legs arrive in', async () => {
    const values: Record<string, unknown> = {
      tariff_code_code: '8481.80.9005',
      tariff_code_country: ['CN'],
    }
    await stampTariffCodeLabel(createEvent(values))
    expect(values.tariff_code_label).toBe('8481.80.9005 CN')
  })

  it('overwrites a caller-supplied label', async () => {
    const values: Record<string, unknown> = {
      tariff_code_code: '8481.80.9005',
      tariff_code_country: { optionId: 'DE' },
      tariff_code_label: 'whatever the script said',
    }
    await stampTariffCodeLabel(createEvent(values))
    expect(values.tariff_code_label).toBe('8481.80.9005 DE')
  })

  it('leaves a create with no code alone - the required-field check refuses it anyway', async () => {
    const values: Record<string, unknown> = { tariff_code_country: 'CN' }
    await stampTariffCodeLabel(createEvent(values))
    expect(values.tariff_code_label).toBeUndefined()
  })
})

describe('restampTariffCodeLabel', () => {
  it('ignores writes to other fields', async () => {
    await restampTariffCodeLabel(changeEvent('tariff_code_description', 'Valves'))
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('re-composes from the changed code and the stored country', async () => {
    h.where.mockResolvedValue([{ valueText: null, optionId: 'CN' }])
    await restampTariffCodeLabel(changeEvent('tariff_code_code', '8481.80.9010'))
    expect(h.setValueWithType).toHaveBeenCalledWith(
      { organizationId: 'org_1' },
      expect.objectContaining({
        fieldId: 'f_label',
        value: { type: 'text', value: '8481.80.9010 CN' },
      })
    )
  })

  it('re-composes from the stored code and the changed country', async () => {
    h.where.mockResolvedValue([{ valueText: '8481.80.9005', optionId: null }])
    await restampTariffCodeLabel(changeEvent('tariff_code_country', ['DE']))
    expect(h.setValueWithType).toHaveBeenCalledWith(
      { organizationId: 'org_1' },
      expect.objectContaining({ value: { type: 'text', value: '8481.80.9005 DE' } })
    )
  })

  it('never throws out of the edit that triggered it', async () => {
    h.bySystemAttributes.mockRejectedValue(new Error('cache down'))
    await expect(
      restampTariffCodeLabel(changeEvent('tariff_code_code', '8481'))
    ).resolves.toBeUndefined()
  })
})
