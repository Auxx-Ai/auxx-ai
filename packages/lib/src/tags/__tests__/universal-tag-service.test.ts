// packages/lib/src/tags/__tests__/universal-tag-service.test.ts

import type { Database } from '@auxx/database'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UniversalTagService } from '../universal-tag-service'

// Mock @auxx/database with schema symbols used by the service
vi.mock('@auxx/database', () => ({
  schema: {
    CustomField: {
      id: 'CustomField.id',
      systemAttribute: 'CustomField.systemAttribute',
      organizationId: 'CustomField.organizationId',
    },
    FieldValue: {
      id: 'FieldValue.id',
      fieldId: 'FieldValue.fieldId',
      entityId: 'FieldValue.entityId',
      relatedEntityId: 'FieldValue.relatedEntityId',
    },
    Tag: {
      id: 'Tag.id',
    },
    Label: {
      labelId: 'Label.labelId',
      organizationId: 'Label.organizationId',
      integrationId: 'Label.integrationId',
    },
    IntegrationTagLabel: Symbol('IntegrationTagLabel'),
  },
}))

// Mock @auxx/logger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock @auxx/utils
vi.mock('@auxx/utils', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock-id`),
}))

// ---- Helpers for building a chainable mock Database ----

const ORG_ID = 'org-test-123'
const FIELD_ID = 'field-thread-tags'

/**
 * Creates a mock Database instance with chainable query builder methods.
 * Each test can override individual query/findFirst/findMany return values.
 */
function createMockDb() {
  // -- Chainable select builder --
  const selectBuilder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  }

  // -- Chainable insert builder --
  const insertBuilder = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
  }

  // -- Chainable update builder --
  const updateBuilder = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  }

  // -- Chainable delete builder --
  const deleteBuilder = {
    where: vi.fn().mockResolvedValue(undefined),
  }

  const db = {
    query: {
      IntegrationTagLabel: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      Tag: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    select: vi.fn().mockReturnValue(selectBuilder),
    insert: vi.fn().mockReturnValue(insertBuilder),
    update: vi.fn().mockReturnValue(updateBuilder),
    delete: vi.fn().mockReturnValue(deleteBuilder),
    _selectBuilder: selectBuilder,
    _insertBuilder: insertBuilder,
    _updateBuilder: updateBuilder,
    _deleteBuilder: deleteBuilder,
  }

  return db
}

type MockDb = ReturnType<typeof createMockDb>

/**
 * Configures the mock DB so that getThreadTagsFieldId() returns FIELD_ID.
 * The service calls db.select().from().where().limit(1) to resolve the CustomField ID.
 */
function mockThreadTagsFieldResolution(db: MockDb, fieldId: string | null = FIELD_ID) {
  db._selectBuilder.limit.mockResolvedValueOnce(fieldId ? [{ id: fieldId }] : [])
}

describe('UniversalTagService', () => {
  let db: MockDb
  let service: UniversalTagService

  beforeEach(() => {
    db = createMockDb()
    service = new UniversalTagService(db as unknown as Database, ORG_ID)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ──────────────────────────────────────────────────────────
  // getOrCreateLinkedLabel
  // ──────────────────────────────────────────────────────────
  describe('getOrCreateLinkedLabel', () => {
    const tagId = 'tag-1'
    const integrationId = 'int-1'
    const providerType = 'google' as const

    it('should return existing linked label when found', async () => {
      db.query.IntegrationTagLabel.findFirst.mockResolvedValueOnce({
        id: 'link-1',
        labelId: 'label-1',
        label: { name: 'Urgent' },
        tag: { title: 'Urgent' },
      })

      const result = await service.getOrCreateLinkedLabel(tagId, integrationId, providerType)

      expect(result).toEqual({
        id: 'link-1',
        labelId: 'label-1',
        name: 'Urgent',
      })
      expect(db.query.IntegrationTagLabel.findFirst).toHaveBeenCalledWith({
        where: expect.any(Function),
        with: { label: true, tag: true },
      })
    })

    it('should return null when tag is not found', async () => {
      db.query.IntegrationTagLabel.findFirst.mockResolvedValueOnce(null)
      db.query.Tag.findFirst.mockResolvedValueOnce(null)

      const result = await service.getOrCreateLinkedLabel(tagId, integrationId, providerType)

      expect(result).toBeNull()
    })

    it('should return null when tag belongs to a different organization', async () => {
      db.query.IntegrationTagLabel.findFirst.mockResolvedValueOnce(null)
      db.query.Tag.findFirst.mockResolvedValueOnce({
        id: tagId,
        title: 'Urgent',
        color: '#FF0000',
        organizationId: 'different-org',
      })

      const result = await service.getOrCreateLinkedLabel(tagId, integrationId, providerType)

      expect(result).toBeNull()
    })

    it('should create Label + IntegrationTagLabel when no link exists', async () => {
      db.query.IntegrationTagLabel.findFirst.mockResolvedValueOnce(null)
      db.query.Tag.findFirst.mockResolvedValueOnce({
        id: tagId,
        title: 'Urgent',
        color: '#FF0000',
        organizationId: ORG_ID,
      })

      // First insert -> Label, second insert -> IntegrationTagLabel
      const mockLabel = { id: 'label-new', name: 'Urgent' }
      const mockLink = { id: 'link-new', labelId: 'label-new' }
      db._insertBuilder.returning
        .mockResolvedValueOnce([mockLabel])
        .mockResolvedValueOnce([mockLink])

      const result = await service.getOrCreateLinkedLabel(tagId, integrationId, providerType)

      expect(result).toEqual({
        id: 'link-new',
        labelId: 'label-new',
        name: 'Urgent',
      })
      // Two inserts: Label and IntegrationTagLabel
      expect(db.insert).toHaveBeenCalledTimes(2)
    })

    it('should call providerCreateLabel and use returned id when provided', async () => {
      db.query.IntegrationTagLabel.findFirst.mockResolvedValueOnce(null)
      db.query.Tag.findFirst.mockResolvedValueOnce({
        id: tagId,
        title: 'Urgent',
        color: '#FF0000',
        organizationId: ORG_ID,
      })

      const providerCreateLabel = vi.fn().mockResolvedValue({
        id: 'provider-lbl-1',
        name: 'Urgent',
      })

      const mockLabel = { id: 'label-new', name: 'Urgent' }
      const mockLink = { id: 'link-new', labelId: 'label-new' }
      db._insertBuilder.returning
        .mockResolvedValueOnce([mockLabel])
        .mockResolvedValueOnce([mockLink])

      const result = await service.getOrCreateLinkedLabel(
        tagId,
        integrationId,
        providerType,
        providerCreateLabel
      )

      expect(providerCreateLabel).toHaveBeenCalledWith('Urgent', '#FF0000')
      expect(result).toBeDefined()
      expect(db.insert).toHaveBeenCalledTimes(2)
    })

    it('should fall back to local-only label when providerCreateLabel throws', async () => {
      db.query.IntegrationTagLabel.findFirst.mockResolvedValueOnce(null)
      db.query.Tag.findFirst.mockResolvedValueOnce({
        id: tagId,
        title: 'Urgent',
        color: null,
        organizationId: ORG_ID,
      })

      const providerCreateLabel = vi.fn().mockRejectedValue(new Error('API failure'))

      const mockLabel = { id: 'label-local', name: 'Urgent' }
      const mockLink = { id: 'link-local', labelId: 'label-local' }
      db._insertBuilder.returning
        .mockResolvedValueOnce([mockLabel])
        .mockResolvedValueOnce([mockLink])

      const result = await service.getOrCreateLinkedLabel(
        tagId,
        integrationId,
        providerType,
        providerCreateLabel
      )

      // Should still succeed even though provider label creation failed
      expect(result).toEqual({
        id: 'link-local',
        labelId: 'label-local',
        name: 'Urgent',
      })
    })

    it('should propagate database errors', async () => {
      db.query.IntegrationTagLabel.findFirst.mockRejectedValueOnce(new Error('Connection lost'))

      await expect(
        service.getOrCreateLinkedLabel(tagId, integrationId, providerType)
      ).rejects.toThrow('Connection lost')
    })
  })

  // ──────────────────────────────────────────────────────────
  // applyTag
  // ──────────────────────────────────────────────────────────
  describe('applyTag', () => {
    const params = {
      tagId: 'tag-1',
      entityType: 'thread' as const,
      entityId: 'thread-1',
      createdBy: 'user-1',
    }

    it('should resolve the thread_tags CustomField and insert a FieldValue', async () => {
      // First select -> getThreadTagsFieldId
      mockThreadTagsFieldResolution(db)
      // Second select -> check existing FieldValue (none)
      db._selectBuilder.limit.mockResolvedValueOnce([])

      const result = await service.applyTag(params)

      expect(result).toEqual({ id: `${params.tagId}-${params.entityId}` })
      // Insert into FieldValue
      expect(db.insert).toHaveBeenCalledTimes(1)
      expect(db._insertBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'fv_mock-id',
          fieldId: FIELD_ID,
          entityId: params.entityId,
          relatedEntityId: params.tagId,
        })
      )
    })

    it('should return existing id when tag is already applied', async () => {
      mockThreadTagsFieldResolution(db)
      // Existing FieldValue found
      db._selectBuilder.limit.mockResolvedValueOnce([{ id: 'fv-existing' }])

      const result = await service.applyTag(params)

      expect(result).toEqual({ id: `${params.tagId}-${params.entityId}` })
      // No insert should happen
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('should throw when thread_tags field is not found', async () => {
      // CustomField not found
      mockThreadTagsFieldResolution(db, null)

      await expect(service.applyTag(params)).rejects.toThrow(
        'Thread tags field not found for organization'
      )
    })

    it('should throw for unsupported entity types', async () => {
      await expect(
        service.applyTag({
          tagId: 'tag-1',
          entityType: 'customer' as const,
          entityId: 'cust-1',
          createdBy: 'user-1',
        })
      ).rejects.toThrow('Entity type customer is not yet supported for tagging')
    })

    it('should cache the thread_tags field id across multiple calls', async () => {
      // Only the first call should trigger the CustomField lookup
      mockThreadTagsFieldResolution(db)
      db._selectBuilder.limit.mockResolvedValueOnce([]) // check existing (call 1)
      db._selectBuilder.limit.mockResolvedValueOnce([]) // check existing (call 2)

      await service.applyTag(params)
      await service.applyTag({ ...params, entityId: 'thread-2' })

      // db.select() called 3 times: 1 CustomField lookup + 2 FieldValue existence checks
      expect(db.select).toHaveBeenCalledTimes(3)
    })
  })

  // ──────────────────────────────────────────────────────────
  // removeTag
  // ──────────────────────────────────────────────────────────
  describe('removeTag', () => {
    const params = {
      tagId: 'tag-1',
      entityType: 'thread' as const,
      entityId: 'thread-1',
    }

    it('should delete the FieldValue for the tag-thread relationship', async () => {
      mockThreadTagsFieldResolution(db)

      await service.removeTag(params)

      expect(db.delete).toHaveBeenCalledTimes(1)
      expect(db._deleteBuilder.where).toHaveBeenCalled()
    })

    it('should throw when thread_tags field is not found', async () => {
      mockThreadTagsFieldResolution(db, null)

      await expect(service.removeTag(params)).rejects.toThrow(
        'Thread tags field not found for organization'
      )
    })

    it('should throw for unsupported entity types', async () => {
      await expect(
        service.removeTag({
          tagId: 'tag-1',
          entityType: 'message' as const,
          entityId: 'msg-1',
        })
      ).rejects.toThrow('Entity type message is not yet supported for tag removal')
    })

    it('should swallow "Record to delete does not exist" errors gracefully', async () => {
      mockThreadTagsFieldResolution(db)
      db._deleteBuilder.where.mockRejectedValueOnce(new Error('Record to delete does not exist'))

      await expect(service.removeTag(params)).resolves.not.toThrow()
    })

    it('should propagate other database errors', async () => {
      mockThreadTagsFieldResolution(db)
      db._deleteBuilder.where.mockRejectedValueOnce(new Error('Timeout'))

      await expect(service.removeTag(params)).rejects.toThrow('Timeout')
    })
  })

  // ──────────────────────────────────────────────────────────
  // getEntityTags
  // ──────────────────────────────────────────────────────────
  describe('getEntityTags', () => {
    it('should return mapped tags for a thread', async () => {
      // getThreadTagsFieldId
      mockThreadTagsFieldResolution(db)

      // FieldValue select returns tag IDs
      db._selectBuilder.limit.mockImplementation(() => {
        // This is the getThreadTagsFieldId call (already consumed by mockThreadTagsFieldResolution)
        // The FieldValue query does NOT use .limit(), it returns from .where() directly
        return Promise.resolve([])
      })

      // Override the from().where() chain for FieldValue query (no .limit)
      // After getThreadTagsFieldId, the next select().from().where() call is for FieldValues
      const fieldValueResults = [{ relatedEntityId: 'tag-1' }, { relatedEntityId: 'tag-2' }]

      // Reset the selectBuilder for the FieldValue query
      // getEntityTags calls .select().from().where() without .limit()
      // We need the where mock to return the fieldValue results directly on the second select call
      let selectCallCount = 0
      db.select.mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // getThreadTagsFieldId: .select().from().where().limit()
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: FIELD_ID }]),
              }),
            }),
          }
        }
        // getEntityTags FieldValue query: .select().from().where() (no limit)
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(fieldValueResults),
          }),
        }
      })

      // Tag.findMany returns the full tag objects
      db.query.Tag.findMany.mockResolvedValueOnce([
        { id: 'tag-1', title: 'Important', color: '#F59E0B', isSystemTag: true },
        { id: 'tag-2', title: 'Bug Report', color: '#EF4444', isSystemTag: false },
      ])

      const result = await service.getEntityTags('thread', 'thread-1')

      expect(result).toEqual([
        { id: 'tag-1', name: 'Important', color: '#F59E0B', isSystemTag: true },
        { id: 'tag-2', name: 'Bug Report', color: '#EF4444', isSystemTag: false },
      ])
      expect(db.query.Tag.findMany).toHaveBeenCalledWith({
        where: expect.any(Function),
      })
    })

    it('should return empty array when no thread_tags field exists', async () => {
      mockThreadTagsFieldResolution(db, null)

      const result = await service.getEntityTags('thread', 'thread-1')

      expect(result).toEqual([])
    })

    it('should return empty array when no FieldValues exist', async () => {
      let selectCallCount = 0
      db.select.mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: FIELD_ID }]),
              }),
            }),
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }
      })

      const result = await service.getEntityTags('thread', 'thread-1')

      expect(result).toEqual([])
      expect(db.query.Tag.findMany).not.toHaveBeenCalled()
    })

    it('should return empty array for unsupported entity types', async () => {
      const result = await service.getEntityTags('customer', 'cust-1')

      expect(result).toEqual([])
    })

    it('should filter out null relatedEntityId values', async () => {
      let selectCallCount = 0
      db.select.mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: FIELD_ID }]),
              }),
            }),
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi
              .fn()
              .mockResolvedValue([{ relatedEntityId: 'tag-1' }, { relatedEntityId: null }]),
          }),
        }
      })

      db.query.Tag.findMany.mockResolvedValueOnce([
        { id: 'tag-1', title: 'Valid', color: '#000', isSystemTag: false },
      ])

      const result = await service.getEntityTags('thread', 'thread-1')

      // Only tag-1 should be returned; the null entry is filtered
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('tag-1')
    })
  })

  // ──────────────────────────────────────────────────────────
  // syncLabelToTag
  // ──────────────────────────────────────────────────────────
  describe('syncLabelToTag', () => {
    const params = {
      integrationId: 'int-1',
      providerLabelId: 'provider-lbl-1',
      labelName: 'Inbox',
      labelColor: '#3B82F6',
      integrationType: 'google' as const,
    }

    it('should update existing tag when label is already mapped', async () => {
      db.query.IntegrationTagLabel.findFirst.mockResolvedValueOnce({
        id: 'link-existing',
        tag: { id: 'tag-existing', title: 'Old Name', color: '#000' },
        label: { labelId: 'provider-lbl-1' },
      })

      const result = await service.syncLabelToTag(params)

      expect(result).toEqual({ tagId: 'tag-existing' })
      // Should update the tag title/color
      expect(db.update).toHaveBeenCalledTimes(1)
      expect(db._updateBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Inbox',
          color: '#3B82F6',
        })
      )
    })

    it('should skip update when tag name and color are unchanged', async () => {
      db.query.IntegrationTagLabel.findFirst.mockResolvedValueOnce({
        id: 'link-existing',
        tag: { id: 'tag-existing', title: 'Inbox', color: '#3B82F6' },
        label: { labelId: 'provider-lbl-1' },
      })

      const result = await service.syncLabelToTag(params)

      expect(result).toEqual({ tagId: 'tag-existing' })
      expect(db.update).not.toHaveBeenCalled()
    })

    it('should create new tag, label, and link when not found', async () => {
      db.query.IntegrationTagLabel.findFirst.mockResolvedValueOnce(null)

      const mockTag = { id: 'tag-new' }
      const mockLabel = { id: 'label-new' }
      db._insertBuilder.returning
        .mockResolvedValueOnce([mockTag]) // Tag insert
        .mockResolvedValueOnce([mockLabel]) // Label insert (with onConflictDoUpdate)

      const result = await service.syncLabelToTag(params)

      expect(result).toEqual({ tagId: 'tag-new' })
      // Three inserts: Tag, Label (with onConflictDoUpdate), IntegrationTagLabel
      expect(db.insert).toHaveBeenCalledTimes(3)
    })

    it('should propagate database errors', async () => {
      db.query.IntegrationTagLabel.findFirst.mockRejectedValueOnce(new Error('DB unavailable'))

      await expect(service.syncLabelToTag(params)).rejects.toThrow('DB unavailable')
    })
  })

  // ──────────────────────────────────────────────────────────
  // getTagsWithLabels
  // ──────────────────────────────────────────────────────────
  describe('getTagsWithLabels', () => {
    const integrationId = 'int-1'

    it('should return tags mapped with their linked label details', async () => {
      db.query.Tag.findMany.mockResolvedValueOnce([
        {
          id: 'tag-1',
          title: 'Urgent',
          color: '#EF4444',
          integrationTagLabels: [
            {
              labelId: 'label-1',
              label: { name: 'Urgent Label', labelId: 'provider-lbl-1' },
            },
          ],
        },
        {
          id: 'tag-2',
          title: 'Low Priority',
          color: null,
          integrationTagLabels: [],
        },
      ])

      const result = await service.getTagsWithLabels(integrationId)

      expect(result).toEqual([
        {
          tagId: 'tag-1',
          tagName: 'Urgent',
          tagColor: '#EF4444',
          labelId: 'label-1',
          labelName: 'Urgent Label',
          providerLabelId: 'provider-lbl-1',
        },
        {
          tagId: 'tag-2',
          tagName: 'Low Priority',
          tagColor: null,
          labelId: null,
          labelName: null,
          providerLabelId: null,
        },
      ])
    })

    it('should return empty array when no tags exist', async () => {
      db.query.Tag.findMany.mockResolvedValueOnce([])

      const result = await service.getTagsWithLabels(integrationId)

      expect(result).toEqual([])
    })

    it('should propagate database errors', async () => {
      db.query.Tag.findMany.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getTagsWithLabels(integrationId)).rejects.toThrow('Query failed')
    })
  })

  // ──────────────────────────────────────────────────────────
  // ensureSystemTags
  // ──────────────────────────────────────────────────────────
  describe('ensureSystemTags', () => {
    it('should create all 5 system tags when none exist', async () => {
      // All findFirst calls return null (no existing tags)
      db.query.Tag.findFirst.mockResolvedValue(null)

      await service.ensureSystemTags()

      // 5 system tags inserted
      expect(db.insert).toHaveBeenCalledTimes(5)
    })

    it('should update existing system tags instead of creating duplicates', async () => {
      // All findFirst calls return an existing tag
      db.query.Tag.findFirst.mockResolvedValue({
        id: 'existing-sys-tag',
        title: 'Archived',
        organizationId: ORG_ID,
        isSystemTag: true,
      })

      await service.ensureSystemTags()

      // No inserts, only updates
      expect(db.insert).not.toHaveBeenCalled()
      expect(db.update).toHaveBeenCalledTimes(5)
    })

    it('should handle a mix of existing and new system tags', async () => {
      let callCount = 0
      db.query.Tag.findFirst.mockImplementation(() => {
        callCount++
        // First two tags exist, last three do not
        if (callCount <= 2) {
          return Promise.resolve({
            id: `existing-tag-${callCount}`,
            title: `Existing ${callCount}`,
            organizationId: ORG_ID,
          })
        }
        return Promise.resolve(null)
      })

      await service.ensureSystemTags()

      expect(db.update).toHaveBeenCalledTimes(2)
      expect(db.insert).toHaveBeenCalledTimes(3)
    })
  })

  // ──────────────────────────────────────────────────────────
  // getSystemTag
  // ──────────────────────────────────────────────────────────
  describe('getSystemTag', () => {
    it('should return system tag when found', async () => {
      db.query.Tag.findFirst.mockResolvedValueOnce({
        id: 'sys-archived',
        title: 'Archived',
        isSystemTag: true,
        organizationId: ORG_ID,
      })

      const result = await service.getSystemTag('Archived')

      expect(result).toEqual({ id: 'sys-archived', name: 'Archived' })
      expect(db.query.Tag.findFirst).toHaveBeenCalledWith({
        where: expect.any(Function),
      })
    })

    it('should return null when system tag is not found', async () => {
      db.query.Tag.findFirst.mockResolvedValueOnce(null)

      const result = await service.getSystemTag('NonExistent')

      expect(result).toBeNull()
    })

    it('should propagate database errors', async () => {
      db.query.Tag.findFirst.mockRejectedValueOnce(new Error('Read timeout'))

      await expect(service.getSystemTag('Archived')).rejects.toThrow('Read timeout')
    })
  })
})
