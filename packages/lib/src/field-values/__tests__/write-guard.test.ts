// packages/lib/src/field-values/__tests__/write-guard.test.ts
//
// Phase 3 of plans/apps/app-fields-and-entities-plan.md §5: `updatable: false`
// / `creatable: false` is only enforced for `interactive` and `api` writers,
// and only for app-owned / connector-owned fields. Every other origin
// (automation, sync, seed) and every plain/system field is untouched.

import { describe, expect, it } from 'vitest'
import { ForbiddenError } from '../../errors'
import type { ResourceField } from '../../resources/registry/field-types'
import { assertOriginMayWriteFields } from '../write-guard'

function field(overrides: Partial<Omit<ResourceField, 'id'>> & { id: string }): ResourceField {
  return {
    label: overrides.id,
    key: overrides.id,
    type: 'string',
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: true,
    },
    ...overrides,
  } as ResourceField
}

const connectorField = field({
  id: 'f_connector',
  dataConnectorId: 'dc_1',
  capabilities: {
    filterable: true,
    sortable: true,
    creatable: false,
    updatable: false,
    configurable: false,
  },
})

const appField = field({
  id: 'f_app',
  appInstallationId: 'inst_1',
  capabilities: {
    filterable: true,
    sortable: true,
    creatable: false,
    updatable: false,
    configurable: false,
  },
})

const plainField = field({ id: 'f_plain' })

const systemFieldNoStamp = field({
  id: 'f_system',
  systemAttribute: 'ticket_number' as never,
  capabilities: {
    filterable: true,
    sortable: true,
    creatable: false,
    updatable: false,
    configurable: false,
  },
})

const interactive = { kind: 'interactive', userId: 'u_1' } as const
const api = { kind: 'api', userId: 'u_1' } as const
const automation = { kind: 'automation', actor: 'system' } as const
const sync = {
  kind: 'sync',
  source: 'connector',
  ref: 'run_1',
  collector: {} as never,
} as const
const seed = { kind: 'seed', reason: 'backfill' } as const

describe('assertOriginMayWriteFields', () => {
  it('refuses an interactive write to a connector-owned non-updatable column', () => {
    expect(() =>
      assertOriginMayWriteFields(interactive, [connectorField], ['f_connector'], 'update')
    ).toThrow(ForbiddenError)
  })

  it('refuses an interactive create of a connector-owned non-creatable column', () => {
    expect(() =>
      assertOriginMayWriteFields(interactive, [connectorField], ['f_connector'], 'create')
    ).toThrow(ForbiddenError)
  })

  it('refuses an api write to an app-owned non-updatable column', () => {
    expect(() => assertOriginMayWriteFields(api, [appField], ['f_app'], 'update')).toThrow(
      ForbiddenError
    )
  })

  it('allows a sync write of the same connector-owned column', () => {
    expect(() =>
      assertOriginMayWriteFields(sync, [connectorField], ['f_connector'], 'update')
    ).not.toThrow()
  })

  it('allows an automation write of the same app-owned column', () => {
    expect(() =>
      assertOriginMayWriteFields(automation, [appField], ['f_app'], 'update')
    ).not.toThrow()
  })

  it('allows a seed write of the same connector-owned column', () => {
    expect(() =>
      assertOriginMayWriteFields(seed, [connectorField], ['f_connector'], 'update')
    ).not.toThrow()
  })

  it('never guards a plain user field, even on an interactive write', () => {
    expect(() =>
      assertOriginMayWriteFields(interactive, [plainField], ['f_plain'], 'update')
    ).not.toThrow()
  })

  it('never guards a system field with neither appInstallationId nor dataConnectorId', () => {
    expect(() =>
      assertOriginMayWriteFields(interactive, [systemFieldNoStamp], ['ticket_number'], 'update')
    ).not.toThrow()
  })

  it('resolves a write key by systemAttribute as well as by id', () => {
    const appFieldWithAttr = field({
      ...appField,
      id: 'f_app_2',
      systemAttribute: 'app_attr' as never,
    })
    expect(() =>
      assertOriginMayWriteFields(interactive, [appFieldWithAttr], ['app_attr'], 'update')
    ).toThrow(ForbiddenError)
  })

  it('ignores a write key with no matching field', () => {
    expect(() =>
      assertOriginMayWriteFields(interactive, [connectorField], ['unknown_key'], 'update')
    ).not.toThrow()
  })
})
