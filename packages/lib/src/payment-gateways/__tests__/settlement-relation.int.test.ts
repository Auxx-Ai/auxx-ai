// packages/lib/src/payment-gateways/__tests__/settlement-relation.int.test.ts
import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { migration160GatewaySettlementFields } from '../../data-migrations/migrations/160-gateway-settlement-fields'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { seedSession } from '../../resources/crud/write-origin'
import { createEntityDefinitions } from '../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../seed/entity-seeder/types'
import { updateGatewaySettlementSettings } from '../settlement'

vi.mock('../../events', () => ({ publisher: { publishLater: vi.fn(), publish: vi.fn() } }))
vi.mock('../settlement-discovery', () => ({ listSettlementSourceAccounts: async () => [] }))
const db = () => getTestDb() as unknown as Database

describe('gateway receiving bank relationship against PostgreSQL', () => {
  it('persists both relationship ends through the settlement command and remains idempotent', async () => {
    const org = await createTestOrganization()
    const user = await createTestUser()
    await db()
      .update(schema.Organization)
      .set({ systemUserId: user.id })
      .where(eq(schema.Organization.id, org.id))
    const allDefs = await createEntityDefinitions(db(), org.id)
    const defs: EntityDefMap = new Map(
      [...allDefs].filter(([kind]) =>
        ['payment_gateway', 'bank_account', 'gl_account'].includes(kind)
      )
    )
    const fields = await createAllFields(db(), org.id, defs)
    await linkRelationships(db(), defs, fields)
    await linkDisplayFields(db(), defs, fields)
    const crud = new UnifiedCrudHandler(org.id, user.id, db(), undefined, {
      session: seedSession('gateway relationship fixture'),
    })
    const chart = await crud.create(defs.get('gl_account')!.id, {
      gl_account_code: '1000',
      gl_account_name: 'Checking',
      gl_account_type: 'asset',
      gl_account_is_active: true,
    })
    const bank = await crud.create(defs.get('bank_account')!.id, {
      bank_account_name: 'Receiving bank',
      bank_account_currency: 'USD',
      bank_account_gl_account: chart.instance.id,
      bank_account_status: 'manual',
    })
    const gateway = await crud.create(defs.get('payment_gateway')!.id, {
      payment_gateway_name: 'Processor',
      payment_gateway_clearing_account: chart.instance.id,
      payment_gateway_settlement_source: 'manual',
      payment_gateway_status: 'active',
    })
    await updateGatewaySettlementSettings(db(), {
      organizationId: org.id,
      actorUserId: user.id,
      gatewayId: gateway.instance.id,
      patch: { bankAccountId: bank.instance.id, settlementCurrency: 'USD' },
    })
    const gatewayField = await db().query.CustomField.findFirst({
      where: and(
        eq(schema.CustomField.organizationId, org.id),
        eq(schema.CustomField.systemAttribute, 'payment_gateway_settlement_bank_account')
      ),
    })
    const inverseField = await db().query.CustomField.findFirst({
      where: and(
        eq(schema.CustomField.organizationId, org.id),
        eq(schema.CustomField.systemAttribute, 'bank_account_settlement_gateways')
      ),
    })
    const related = await db()
      .select()
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.fieldId, gatewayField!.id))
    expect(related).toHaveLength(1)
    expect(related[0]).toMatchObject({
      entityId: gateway.instance.id,
      relatedEntityId: bank.instance.id,
      relatedEntityDefinitionId: defs.get('bank_account')!.id,
      valueText: null,
    })
    const inverse = await db()
      .select()
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.fieldId, inverseField!.id))
    expect(inverse).toHaveLength(1)
    expect(inverse[0]).toMatchObject({
      entityId: bank.instance.id,
      relatedEntityId: gateway.instance.id,
    })
    const first = await migration160GatewaySettlementFields.up(db(), org.id)
    const second = await migration160GatewaySettlementFields.up(db(), org.id)
    expect(first).toMatchObject({ fieldsCreated: 0 })
    expect(second).toMatchObject({
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: true,
    })
  })
})
