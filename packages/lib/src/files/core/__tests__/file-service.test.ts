// packages/lib/src/files/core/__tests__/file-service.test.ts

import { describe, expect, it, vi } from 'vitest'
import { FileService } from '../file-service'
import type { CreateFileRequest } from '../types'

/**
 * Build a minimal thenable select chain that mimics Drizzle's query builder for tests.
 */
const createSelectChain = (result: any[]) => {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(result)),
    groupBy: vi.fn().mockImplementation(() => Promise.resolve(result)),
    then: (resolve: (value: any[]) => void) => resolve(result),
  }
  return chain
}

describe('FileService create behaviour', () => {
  it('normalizes metadata before insertion', async () => {
    const returningPayload = [{ id: 'file-1' }]
    const returningMock = vi.fn().mockResolvedValue(returningPayload)
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock })
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock })

    const fakeDb: any = {
      insert: insertMock,
    }

    const service = new FileService('org-123', 'user-456', fakeDb)

    const input: CreateFileRequest = {
      name: 'Example.JPG',
      ext: 'JPG',
      path: '/provided/path',
      folderId: '',
      mimeType: 'image/jpeg',
    }

    const result = await service.create(input, fakeDb)

    expect(result).toEqual(returningPayload[0])
    expect(valuesMock).toHaveBeenCalledTimes(1)

    const payload = valuesMock.mock.calls[0][0]
    expect(payload.folderId).toBeNull()
    expect(payload.ext).toBe('jpg')
    expect(payload.path).toBe('/provided/path')
    expect(payload.organizationId).toBe('org-123')
    expect(payload.createdById).toBe('user-456')
    expect(payload.isArchived).toBe(false)
    expect(payload.createdAt).toBeInstanceOf(Date)
    expect(payload.updatedAt).toBeInstanceOf(Date)
  })
})

describe('FileService list behaviour', () => {
  it('reuses scoped filters when computing per-folder counts', async () => {
    const items = [{ id: 'file-1', folderId: 'folder-1' }]
    const totals = [{ value: 1 }]
    const counts = [{ folderId: 'folder-1', _count: 1 }]

    const firstSelect = createSelectChain(items)
    const secondSelect = createSelectChain(totals)
    const thirdSelect = createSelectChain(counts)

    const selectChains = [firstSelect, secondSelect, thirdSelect]

    const fakeDb: any = {
      select: vi.fn(() => {
        const next = selectChains.shift()
        if (!next) {
          throw new Error('Unexpected select invocation')
        }
        return next
      }),
    }

    const service = new FileService('org-123', 'user-456', fakeDb)

    const capturedFilters: Array<Record<string, any> | undefined> = []
    const originalBuildFilterConditions = (service as any).buildFilterConditions.bind(service)
    ;(service as any).buildFilterConditions = (filters?: Record<string, any>) => {
      capturedFilters.push(filters)
      return originalBuildFilterConditions(filters)
    }

    const scopedSpy = vi
      .spyOn<any>(service as any, 'buildScopedWhere')
      .mockReturnValue('mock-sql' as any)

    const result = await service.listInFolder('folder-1', {
      includeCounts: true,
      includeArchived: false,
    })

    expect(result.items).toEqual(items)
    expect(result.total).toBe(1)
    expect(result.counts).toEqual({ 'folder-1': 1 })

    expect(firstSelect.where).toHaveBeenCalledWith('mock-sql')
    expect(secondSelect.where).toHaveBeenCalledWith('mock-sql')
    expect(thirdSelect.where).toHaveBeenCalledWith('mock-sql')

    const countFilters = capturedFilters[1]
    expect(countFilters).toMatchObject({
      folderId: { in: ['folder-1'] },
      isArchived: false,
    })

    expect(selectChains).toHaveLength(0)
    // list() calls buildScopedWhere once (reuses result for items + total queries),
    // listInFolder count logic calls it a second time
    expect(scopedSpy).toHaveBeenCalledTimes(2)
  })
})

describe('FileService search behaviour', () => {
  it('returns empty results for blank queries without hitting the database', async () => {
    const fakeDb: any = {
      select: vi.fn(),
    }

    const service = new FileService('org-123', 'user-456', fakeDb)

    const result = await service.search('   ')

    expect(result).toEqual([])
    expect(fakeDb.select).not.toHaveBeenCalled()
  })
})
