// apps/web/src/server/api/routers/table-view-structural.test.ts

import type { Resource } from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import { isStructural, resolveDefIdFromResources } from './table-view-structural'

/**
 * Def-admin gating logic for table views (perms v2 doc 07). `isStructural`
 * decides WHEN the def-admin gate fires; `resolveDefIdFromResources` decides
 * WHICH def it keys off (the gate primitive `assertAdministerDef` is covered by
 * `capability-set-administer.test.ts`).
 */

/** Minimal Resource fixtures — only the fields the resolver reads. */
const CONTACT_DEF_ID = 'cont_defcuid00000000000000000'
const contactResource = {
  id: CONTACT_DEF_ID,
  type: 'custom',
  entityType: 'contact',
  apiSlug: 'contacts',
  entityDefinitionId: CONTACT_DEF_ID,
} as unknown as Resource

const CUSTOM_DEF_ID = 'proj_defcuid00000000000000000'
const customEntityResource = {
  id: CUSTOM_DEF_ID,
  type: 'custom',
  entityType: undefined,
  apiSlug: 'projects',
  entityDefinitionId: CUSTOM_DEF_ID,
} as unknown as Resource

// Static system type (e.g. thread): slug id, no EntityDefinition row.
const threadResource = {
  id: 'thread',
  type: 'system',
  entityType: 'thread',
  apiSlug: 'threads',
  entityDefinitionId: 'thread',
} as unknown as Resource

const RESOURCES = [contactResource, customEntityResource, threadResource]

describe('isStructural', () => {
  it('panel / dialog field configs are structural', () => {
    expect(isStructural({ contextType: 'panel' })).toBe(true)
    expect(isStructural({ contextType: 'dialog_create' })).toBe(true)
    expect(isStructural({ contextType: 'dialog_edit' })).toBe(true)
  })

  it('setting the org default is structural (any context)', () => {
    expect(isStructural({ contextType: 'table', isDefault: true })).toBe(true)
    expect(isStructural({ contextType: 'kanban', isDefault: true })).toBe(true)
    // The back-door: isDefault:true with no contextType still trips the gate.
    expect(isStructural({ isDefault: true })).toBe(true)
  })

  it('ordinary table / kanban authoring is NOT structural', () => {
    expect(isStructural({ contextType: 'table' })).toBe(false)
    expect(isStructural({ contextType: 'kanban' })).toBe(false)
    expect(isStructural({ contextType: 'table', isDefault: false })).toBe(false)
    // isShared is deliberately not a trigger, so it never appears here — a shared
    // table view with no default flag is still non-structural.
    expect(isStructural({})).toBe(false)
  })
})

describe('resolveDefIdFromResources', () => {
  it('resolves the `entity-<defId>` table/kanban convention', () => {
    expect(resolveDefIdFromResources(`entity-${CONTACT_DEF_ID}`, RESOURCES)).toBe(CONTACT_DEF_ID)
    expect(resolveDefIdFromResources(`entity-${CUSTOM_DEF_ID}`, RESOURCES)).toBe(CUSTOM_DEF_ID)
  })

  it('resolves the bare `<defId>` panel/dialog convention', () => {
    expect(resolveDefIdFromResources(CONTACT_DEF_ID, RESOURCES)).toBe(CONTACT_DEF_ID)
    expect(resolveDefIdFromResources(CUSTOM_DEF_ID, RESOURCES)).toBe(CUSTOM_DEF_ID)
  })

  it('resolves via slug / entityType / apiSlug to the canonical def id', () => {
    expect(resolveDefIdFromResources('entity-contact', RESOURCES)).toBe(CONTACT_DEF_ID)
    expect(resolveDefIdFromResources('contacts', RESOURCES)).toBe(CONTACT_DEF_ID)
    expect(resolveDefIdFromResources('contact', RESOURCES)).toBe(CONTACT_DEF_ID)
  })

  it('returns null for static system types (no EntityDefinition row → org-admin)', () => {
    expect(resolveDefIdFromResources('entity-thread', RESOURCES)).toBeNull()
    expect(resolveDefIdFromResources('thread', RESOURCES)).toBeNull()
  })

  it('returns null for non-entity surfaces', () => {
    expect(resolveDefIdFromResources('workflow-runs', RESOURCES)).toBeNull()
    expect(resolveDefIdFromResources('recordings', RESOURCES)).toBeNull()
    expect(resolveDefIdFromResources('resource-article', RESOURCES)).toBeNull()
    expect(resolveDefIdFromResources('entity-unknowncuid', RESOURCES)).toBeNull()
  })
})
