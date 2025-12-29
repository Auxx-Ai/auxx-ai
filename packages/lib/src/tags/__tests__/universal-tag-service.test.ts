// packages/lib/src/tags/__tests__/universal-tag-service.test.ts

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { IntegrationProviderType } from '@auxx/database/enums'
import { UniversalTagService } from '../universal-tag-service'

// Mock the database
const mockDb = {
  query: {
    IntegrationTagLabel: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    Tag: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    Label: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    TagsOnThread: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

// Mock the logger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('UniversalTagService', () => {
  let service: UniversalTagService
  const organizationId = 'test-org-id'

  beforeEach(() => {
    service = new UniversalTagService(mockDb, organizationId)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getOrCreateLinkedLabel', () => {
    const tagId = 'tag-1'
    const integrationId = 'integration-1'
    const providerType = IntegrationProviderType.email

    it('should return existing linked label if found', async () => {
      const mockExistingLink = {
        id: 'link-1',
        labelId: 'label-1',
        label: { name: 'Test Label' },
        tag: { name: 'Test Tag' },
      }

      mockDb.query.IntegrationTagLabel.findFirst = vi.fn().mockResolvedValue(mockExistingLink)

      const result = await service.getOrCreateLinkedLabel(tagId, integrationId, providerType)

      expect(result).toEqual({
        id: 'link-1',
        labelId: 'label-1',
        name: 'Test Label',
      })
      expect(mockDb.query.IntegrationTagLabel.findFirst).toHaveBeenCalledWith({
        where: expect.any(Function),
        with: { label: true, tag: true },
      })
    })

    it('should create new linked label when none exists', async () => {
      const mockTag = {
        id: tagId,
        name: 'Test Tag',
        color: '#FF0000',
        organizationId,
      }

      const mockLabel = {
        id: 'label-1',
        name: 'Test Tag',
        color: '#FF0000',
      }

      const mockLink = {
        id: 'link-1',
        labelId: 'label-1',
        label: mockLabel,
      }

      mockDb.query.IntegrationTagLabel.findFirst = vi.fn().mockResolvedValue(null)
      mockDb.query.Tag.findFirst = vi.fn().mockResolvedValue(mockTag)
      mockDb.insert = vi.fn().mockResolvedValue([mockLabel])
      mockDb.insert = vi.fn().mockResolvedValue([mockLink])

      const result = await service.getOrCreateLinkedLabel(tagId, integrationId, providerType)

      expect(result).toEqual({
        id: 'link-1',
        labelId: 'label-1',
        name: 'Test Tag',
      })
      expect(mockDb.insert).toHaveBeenCalledWith({
        values: {
          name: 'Test Tag',
          organizationId,
          color: '#FF0000',
          metadata: {
            providerType,
            providerLabelId: null,
            syncedFromTag: true,
          },
        },
      })
    })

    it('should create provider label when creation function provided', async () => {
      const mockTag = {
        id: tagId,
        name: 'Test Tag',
        color: '#FF0000',
        organizationId,
      }

      const mockProviderCreateLabel = vi.fn().mockResolvedValue({
        id: 'provider-label-1',
        name: 'Test Tag',
      })

      const mockLabel = {
        id: 'label-1',
        name: 'Test Tag',
        color: '#FF0000',
      }

      const mockLink = {
        id: 'link-1',
        labelId: 'label-1',
        label: mockLabel,
      }

      mockDb.query.IntegrationTagLabel.findFirst = vi.fn().mockResolvedValue(null)
      mockDb.query.Tag.findFirst = vi.fn().mockResolvedValue(mockTag)
      mockDb.insert = vi.fn().mockResolvedValue([mockLabel])
      mockDb.insert = vi.fn().mockResolvedValue([mockLink])

      const result = await service.getOrCreateLinkedLabel(
        tagId,
        integrationId,
        providerType,
        mockProviderCreateLabel
      )

      expect(mockProviderCreateLabel).toHaveBeenCalledWith('Test Tag', '#FF0000')
      expect(mockDb.insert).toHaveBeenCalledWith({
        values: {
          name: 'Test Tag',
          organizationId,
          color: '#FF0000',
          metadata: {
            providerType,
            providerLabelId: 'provider-label-1',
            syncedFromTag: true,
          },
        },
      })
      expect(result).toBeDefined()
    })

    it('should handle tag not found', async () => {
      mockDb.query.IntegrationTagLabel.findFirst = vi.fn().mockResolvedValue(null)
      mockDb.query.Tag.findFirst = vi.fn().mockResolvedValue(null)

      const result = await service.getOrCreateLinkedLabel(tagId, integrationId, providerType)

      expect(result).toBeNull()
    })

    it('should handle tag from different organization', async () => {
      const mockTag = {
        id: tagId,
        name: 'Test Tag',
        organizationId: 'different-org',
      }

      mockDb.query.IntegrationTagLabel.findFirst = vi.fn().mockResolvedValue(null)
      mockDb.query.Tag.findFirst = vi.fn().mockResolvedValue(mockTag)

      const result = await service.getOrCreateLinkedLabel(tagId, integrationId, providerType)

      expect(result).toBeNull()
    })
  })

  describe('applyTag', () => {
    const params = {
      tagId: 'tag-1',
      entityType: 'thread' as const,
      entityId: 'thread-1',
      createdBy: 'user-1',
    }

    it('should apply tag when not already applied', async () => {
      const mockTagOnEntity = { id: 'tag-on-entity-1' }

      mockDb.query.TagsOnThread.findFirst = vi.fn().mockResolvedValue(null)
      mockDb.insert = vi.fn().mockResolvedValue([mockTagOnEntity])

      const result = await service.applyTag(params)

      expect(result).toEqual({ id: 'tag-on-entity-1' })
      expect(mockDb.insert).toHaveBeenCalledWith({
        values: params,
      })
    })

    it('should return existing tag application if already applied', async () => {
      const mockExistingTagOnEntity = { id: 'existing-tag-on-entity' }

      mockDb.query.TagsOnThread.findFirst = vi.fn().mockResolvedValue(mockExistingTagOnEntity)

      const result = await service.applyTag(params)

      expect(result).toEqual({ id: 'existing-tag-on-entity' })
      expect(mockDb.insert).not.toHaveBeenCalled()
    })
  })

  describe('removeTag', () => {
    const params = {
      tagId: 'tag-1',
      entityType: 'thread' as const,
      entityId: 'thread-1',
    }

    it('should remove tag successfully', async () => {
      mockDb.delete = vi.fn().mockResolvedValue(undefined)

      await expect(service.removeTag(params)).resolves.not.toThrow()
      expect(mockDb.delete).toHaveBeenCalledWith({
        where: {
          tagId: params.tagId,
          entityType: params.entityType,
          entityId: params.entityId,
        },
      })
    })

    it('should handle tag not applied gracefully', async () => {
      const error = new Error('Record to delete does not exist')
      mockDb.delete = vi.fn().mockRejectedValue(error)

      await expect(service.removeTag(params)).resolves.not.toThrow()
    })

    it('should throw on other errors', async () => {
      const error = new Error('Database connection failed')
      mockDb.delete = vi.fn().mockRejectedValue(error)

      await expect(service.removeTag(params)).rejects.toThrow('Database connection failed')
    })
  })

  describe('getEntityTags', () => {
    it('should return tags for entity', async () => {
      const mockTagsOnEntity = [
        {
          tag: {
            id: 'tag-1',
            name: 'Important',
            color: '#FF0000',
            isSystemTag: true,
          },
        },
        {
          tag: {
            id: 'tag-2',
            name: 'Customer Issue',
            color: '#00FF00',
            isSystemTag: false,
          },
        },
      ]

      mockDb.query.TagsOnThread.findMany = vi.fn().mockResolvedValue(mockTagsOnEntity)

      const result = await service.getEntityTags('thread', 'thread-1')

      expect(result).toEqual([
        {
          id: 'tag-1',
          name: 'Important',
          color: '#FF0000',
          isSystemTag: true,
        },
        {
          id: 'tag-2',
          name: 'Customer Issue',
          color: '#00FF00',
          isSystemTag: false,
        },
      ])
    })

    it('should return empty array when no tags found', async () => {
      mockDb.query.TagsOnThread.findMany = vi.fn().mockResolvedValue([])

      const result = await service.getEntityTags('thread', 'thread-1')

      expect(result).toEqual([])
    })
  })

  describe('syncLabelToTag', () => {
    const params = {
      integrationId: 'integration-1',
      providerLabelId: 'provider-label-1',
      labelName: 'New Label',
      labelColor: '#0000FF',
      integrationType: 'google' as const,
    }

    it('should update existing tag when label already mapped', async () => {
      const mockExistingLabel = {
        integrationTagLabels: [
          {
            tag: {
              id: 'tag-1',
              name: 'Old Name',
              color: '#FF0000',
            },
          },
        ],
      }

      mockDb.query.Label.findFirst = vi.fn().mockResolvedValue(mockExistingLabel)
      mockDb.update = vi.fn().mockResolvedValue([{ id: 'tag-1' }])

      const result = await service.syncLabelToTag(params)

      expect(result).toEqual({ tagId: 'tag-1' })
      expect(mockDb.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        set: {
          name: 'New Label',
          color: '#0000FF',
        },
      })
    })

    it('should create new tag and label when not found', async () => {
      const mockTag = { id: 'new-tag-1' }
      const mockLabel = { id: 'new-label-1' }

      mockDb.query.Label.findFirst = vi.fn().mockResolvedValue(null)
      mockDb.insert = vi.fn().mockResolvedValue([mockTag])
      mockDb.insert = vi.fn().mockResolvedValue([mockLabel])
      mockDb.insert = vi.fn().mockResolvedValue([{}])

      const result = await service.syncLabelToTag(params)

      expect(result).toEqual({ tagId: 'new-tag-1' })
      expect(mockDb.insert).toHaveBeenCalledWith({
        values: {
          name: 'New Label',
          color: '#0000FF',
          organizationId,
          isSystemTag: false,
        },
      })
    })
  })

  describe('getTagsWithLabels', () => {
    it('should return tags with their linked labels', async () => {
      const mockTags = [
        {
          id: 'tag-1',
          name: 'Tag 1',
          color: '#FF0000',
          integrationTagLabels: [
            {
              labelId: 'label-1',
              label: {
                name: 'Label 1',
                metadata: { providerLabelId: 'provider-1' },
              },
            },
          ],
        },
        {
          id: 'tag-2',
          name: 'Tag 2',
          color: null,
          integrationTagLabels: [],
        },
      ]

      mockDb.query.Tag.findMany = vi.fn().mockResolvedValue(mockTags)

      const result = await service.getTagsWithLabels('integration-1')

      expect(result).toEqual([
        {
          tagId: 'tag-1',
          tagName: 'Tag 1',
          tagColor: '#FF0000',
          labelId: 'label-1',
          labelName: 'Label 1',
          providerLabelId: 'provider-1',
        },
        {
          tagId: 'tag-2',
          tagName: 'Tag 2',
          tagColor: null,
          labelId: null,
          labelName: null,
          providerLabelId: null,
        },
      ])
    })
  })

  describe('ensureSystemTags', () => {
    it("should create system tags if they don't exist", async () => {
      mockDb.insert = vi.fn().mockResolvedValue({})

      await service.ensureSystemTags()

      expect(mockDb.insert).toHaveBeenCalledTimes(5) // 5 system tags
    })
  })

  describe('getSystemTag', () => {
    it('should return system tag when found', async () => {
      const mockTag = {
        id: 'system-tag-1',
        name: 'Archived',
        isSystemTag: true,
      }

      mockDb.query.Tag.findFirst = vi.fn().mockResolvedValue(mockTag)

      const result = await service.getSystemTag('Archived')

      expect(result).toEqual({
        id: 'system-tag-1',
        name: 'Archived',
      })
    })

    it('should return null when tag not found', async () => {
      mockDb.query.Tag.findFirst = vi.fn().mockResolvedValue(null)

      const result = await service.getSystemTag('NonExistent')

      expect(result).toBeNull()
    })

    it('should return null when tag is not a system tag', async () => {
      const mockTag = {
        id: 'user-tag-1',
        name: 'UserTag',
        isSystemTag: false,
      }

      mockDb.query.Tag.findFirst = vi.fn().mockResolvedValue(mockTag)

      const result = await service.getSystemTag('UserTag')

      expect(result).toBeNull()
    })
  })

  describe('Error Handling', () => {
    it('should handle database errors in getOrCreateLinkedLabel', async () => {
      mockDb.query.IntegrationTagLabel.findFirst = vi.fn().mockRejectedValue(new Error('DB Error'))

      await expect(
        service.getOrCreateLinkedLabel('tag-1', 'integration-1', IntegrationProviderType.email)
      ).rejects.toThrow('DB Error')
    })

    it('should handle database errors in applyTag', async () => {
      mockDb.query.TagsOnThread.findFirst = vi.fn().mockRejectedValue(new Error('DB Error'))

      await expect(
        service.applyTag({
          tagId: 'tag-1',
          entityType: 'thread',
          entityId: 'thread-1',
          createdBy: 'user-1',
        })
      ).rejects.toThrow('DB Error')
    })
  })
})