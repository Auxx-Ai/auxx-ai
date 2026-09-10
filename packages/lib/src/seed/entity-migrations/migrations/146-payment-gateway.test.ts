// packages/lib/src/seed/entity-migrations/migrations/146-payment-gateway.test.ts
//
// A new entity type is a hand-edit across several files (`enums.ts`,
// `enum-values.ts`, `field-registry.ts`, `create-fields.ts`, `constants.ts`,
// `types/resource/utils.ts`, the system-attribute union), and getting one
// wrong creates a def the app can half see: the records path resolves it and
// the seeder does not, or the reverse. 125's test pins the same checklist for
// its five new entity types; this pins it for `payment_gateway`.

import { ModelTypeMeta, ModelTypes, ModelTypeValues } from '@auxx/database/enums'
import { ENTITY_DEFINITION_TYPES } from '@auxx/types/resource'
import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import { PAYMENT_GATEWAY_FIELDS } from '../../../resources/registry/resources/payment-gateway-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { FIELD_REGISTRY } from '../../entity-seeder/create-fields'
import { migration146PaymentGateway } from './146-payment-gateway'

const MIGRATION_ID = '146-payment-gateway'

describe('migration 146 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leaves every registered id on a distinct number, and 146 is free', () => {
    const numbers = ALL_ENTITY_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(ALL_ENTITY_MIGRATIONS.filter((m) => m.id.split('-')[0] === '146')).toHaveLength(1)
  })

  it('exports the migration it registers', () => {
    expect(ALL_ENTITY_MIGRATIONS).toContain(migration146PaymentGateway)
  })
})

describe('payment_gateway is registered everywhere a def has to be', () => {
  it('is a ModelTypeValues entry, mapped in ModelTypes, with EntityInstance meta', () => {
    expect(ModelTypeValues).toContain('payment_gateway')
    expect(ModelTypes.PAYMENT_GATEWAY).toBe('payment_gateway')
    expect(ModelTypeMeta.payment_gateway.apiSlug).toBe('payment-gateways')
    expect(ModelTypeMeta.payment_gateway.dbTable).toBe('EntityInstance')
    // No `/app/payment-gateways/[id]` route exists; claiming one puts a
    // fullscreen button on the drawer that 404s.
    expect(ModelTypeMeta.payment_gateway.hasDetailPage).toBe(false)
  })

  it('is an EntityDefinitionType, so a payment_gateway:<id> RecordId canonicalizes', () => {
    expect(ENTITY_DEFINITION_TYPES).toContain('payment_gateway')
  })

  it('resolves the SAME field map in both registries used by the two seeders', () => {
    expect(RESOURCE_FIELD_REGISTRY.payment_gateway).toBe(PAYMENT_GATEWAY_FIELDS)
    expect(FIELD_REGISTRY.payment_gateway).toBe(PAYMENT_GATEWAY_FIELDS)
  })

  it('is a hidden SYSTEM_ENTITIES entry - the door is the settings screen, not a sidebar', () => {
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'payment_gateway')
    expect(entity).toBeDefined()
    expect(entity?.apiSlug).toBe('payment-gateways')
    expect(entity?.isVisible).toBe(false)
  })

  it('every field carries a systemAttribute in the shared union', () => {
    for (const field of Object.values(PAYMENT_GATEWAY_FIELDS)) {
      expect(SYSTEM_ATTRIBUTES).toContain(field.systemAttribute)
    }
  })

  it('displays as fields that exist, and name and settlementSource are never null', () => {
    const config = DISPLAY_FIELD_CONFIG.payment_gateway
    expect(config).toEqual({
      primaryDisplayField: 'name',
      secondaryDisplayField: 'settlementSource',
    })
    expect(PAYMENT_GATEWAY_FIELDS[config!.primaryDisplayField]).toBeDefined()
    expect(PAYMENT_GATEWAY_FIELDS[config!.secondaryDisplayField!]).toBeDefined()
  })

  it('keeps name, handles and clearingAccount required; feeAccount and lastSettlementAt nullable', () => {
    expect(PAYMENT_GATEWAY_FIELDS.name?.nullable).toBe(false)
    expect(PAYMENT_GATEWAY_FIELDS.handles?.nullable).toBe(false)
    expect(PAYMENT_GATEWAY_FIELDS.clearingAccount?.nullable).toBe(false)
    expect(PAYMENT_GATEWAY_FIELDS.feeAccount?.nullable).toBe(true)
    expect(PAYMENT_GATEWAY_FIELDS.lastSettlementAt?.nullable).toBe(true)
  })

  it('stores clearingAccount and feeAccount as plain TEXT ids, never a RELATIONSHIP', () => {
    expect(PAYMENT_GATEWAY_FIELDS.clearingAccount?.type).not.toBe('RELATION')
    expect(PAYMENT_GATEWAY_FIELDS.feeAccount?.type).not.toBe('RELATION')
  })

  it('gives handles a TAGS shape, so two spellings of one rail can share a row', () => {
    expect(PAYMENT_GATEWAY_FIELDS.handles?.fieldType).toBe('TAGS')
  })

  it('defaults settlementSource to manual and status to active', () => {
    expect(PAYMENT_GATEWAY_FIELDS.settlementSource?.defaultValue).toBe('manual')
    expect(PAYMENT_GATEWAY_FIELDS.status?.defaultValue).toBe('active')
  })
})
