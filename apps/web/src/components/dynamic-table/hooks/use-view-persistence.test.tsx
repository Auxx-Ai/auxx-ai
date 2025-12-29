// apps/web/src/components/dynamic-table/hooks/use-view-persistence.test.tsx

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Table } from '@tanstack/react-table'
import { useViewPersistence } from './use-view-persistence'
import type { TableFilter, TableView, ViewConfig } from '../types'

/** Mock TRPC mutateAsync implementation used across tests. */
const mutateAsyncMock = vi.fn()
/** Mock useMutation factory returning the mutateAsync stub. */
const useMutationMock = vi.fn()

vi.mock('~/trpc/react', () => ({
  api: {
    tableView: {
      update: {
        useMutation: useMutationMock,
      },
    },
  },
}))

/** Shared filter configuration used to construct sample view configs. */
const baseFilters: TableFilter[] = [
  { id: 'filter-1', columnId: 'name', operator: 'contains', value: 'demo' },
]

/** Canonical view configuration leveraged throughout the suite. */
const baseConfig: ViewConfig = {
  filters: baseFilters,
  sorting: [{ id: 'name', desc: false }],
  columnVisibility: { name: true },
  columnOrder: ['name'],
  columnSizing: { name: 120 },
  columnPinning: { left: ['_checkbox'] },
  rowHeight: 'normal',
}

/** Active view metadata that mirrors the default server response. */
const activeView: TableView = {
  id: 'view-1',
  name: 'Primary',
  tableId: 'table-1',
  config: baseConfig,
}

/** Minimal table state shape needed by the view persistence hook. */
type MockTableState = {
  columnVisibility: ViewConfig['columnVisibility']
  columnSizing: ViewConfig['columnSizing']
  columnOrder: ViewConfig['columnOrder']
  columnPinning: ViewConfig['columnPinning']
  sorting: ViewConfig['sorting']
}

/** Build a lightweight tanstack table mock that satisfies the hook contract. */
const createMockTable = (stateOverrides: Partial<MockTableState> = {}) => {
  const baseState: MockTableState = {
    columnVisibility: baseConfig.columnVisibility,
    columnSizing: baseConfig.columnSizing,
    columnOrder: baseConfig.columnOrder,
    columnPinning: baseConfig.columnPinning,
    sorting: baseConfig.sorting,
  }

  return {
    getState: () => ({ ...baseState, ...stateOverrides }),
  } as unknown as Table<any>
}

beforeEach(() => {
  mutateAsyncMock.mockReset().mockResolvedValue(undefined)
  useMutationMock.mockReset().mockImplementation(() => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
    error: null,
  }))
})

describe('useViewPersistence', () => {
  it('flags unsaved changes when table state diverges from the saved config', async () => {
    const table = createMockTable()
    const { result, rerender } = renderHook((props) => useViewPersistence(props), {
      initialProps: {
        table,
        currentView: activeView,
        enabled: true,
        filters: baseConfig.filters,
        rowHeight: baseConfig.rowHeight,
        columnVisibility: baseConfig.columnVisibility,
        columnSizing: baseConfig.columnSizing,
        columnOrder: baseConfig.columnOrder,
        columnPinning: baseConfig.columnPinning,
        sorting: baseConfig.sorting,
      },
    })

    expect(result.current.hasUnsavedChanges).toBe(false)

    rerender({
      table,
      currentView: activeView,
      enabled: true,
      filters: baseConfig.filters,
      rowHeight: baseConfig.rowHeight,
      columnVisibility: baseConfig.columnVisibility,
      columnSizing: baseConfig.columnSizing,
      columnOrder: baseConfig.columnOrder,
      columnPinning: baseConfig.columnPinning,
      sorting: [{ id: 'name', desc: true }],
    })

    await waitFor(() => expect(result.current.hasUnsavedChanges).toBe(true))
  })

  it('persists changes on demand and resets the dirty flag', async () => {
    const table = createMockTable()
    const { result, rerender } = renderHook((props) => useViewPersistence(props), {
      initialProps: {
        table,
        currentView: activeView,
        enabled: true,
        filters: baseConfig.filters,
        rowHeight: baseConfig.rowHeight,
        columnVisibility: baseConfig.columnVisibility,
        columnSizing: baseConfig.columnSizing,
        columnOrder: baseConfig.columnOrder,
        columnPinning: baseConfig.columnPinning,
        sorting: baseConfig.sorting,
      },
    })

    rerender({
      table,
      currentView: activeView,
      enabled: true,
      filters: baseConfig.filters,
      rowHeight: baseConfig.rowHeight,
      columnVisibility: baseConfig.columnVisibility,
      columnSizing: baseConfig.columnSizing,
      columnOrder: baseConfig.columnOrder,
      columnPinning: baseConfig.columnPinning,
      sorting: [{ id: 'name', desc: true }],
    })

    await waitFor(() => expect(result.current.hasUnsavedChanges).toBe(true))

    await act(async () => {
      await result.current.save()
    })

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1)
    expect(mutateAsyncMock).toHaveBeenCalledWith({
      id: activeView.id,
      config: expect.objectContaining({ sorting: [{ id: 'name', desc: true }] }),
    })

    await waitFor(() => expect(result.current.hasUnsavedChanges).toBe(false))

    const lastSaved = result.current.getLastSavedConfig()
    expect(lastSaved?.sorting).toEqual([{ id: 'name', desc: true }])
  })
})
