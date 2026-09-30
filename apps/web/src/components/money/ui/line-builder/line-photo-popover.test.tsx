// apps/web/src/components/money/ui/line-builder/line-photo-popover.test.tsx

import type { Line } from '@auxx/lib/accounting/documents/lines/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUploadStore } from '~/components/file-upload/stores'
import { createFakeUploadTransport } from '~/components/file-upload/transport/__fixtures__/fake-upload-transport'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { getFileRefStoreState } from '~/components/resources/store/file-ref-store'
import { buildCanonicalFieldValueKey } from '~/components/resources/utils/canonicalize-field-ref'
import { LineBuilder } from './line-builder'

const h = vi.hoisted(() => ({ add: vi.fn(), queueFetch: vi.fn(), lines: [] as unknown[] }))

vi.mock('@auxx/ui/components/toast', () => ({ toastError: vi.fn() }))
vi.mock('~/trpc/vanilla', () => ({
  vanillaApi: { fieldValue: { add: { mutate: h.add }, set: { mutate: vi.fn() } } },
}))
vi.mock('~/trpc/react', () => ({
  api: {
    lines: { list: { useQuery: () => ({ data: h.lines, isLoading: false }) } },
    fieldValue: { remove: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}))
vi.mock('./lines-cache', () => ({
  useLinesSync: () => {},
  useLineWrites: () => ({}),
}))
vi.mock('./totals-footer', () => ({ TotalsFooter: () => null }))
vi.mock('./catalog-picker', () => ({ CatalogPicker: () => null }))
vi.mock('~/components/resources', async () => {
  const { parseRecordId, toRecordId } = await import('@auxx/lib/resources/client')
  return {
    parseRecordId,
    toRecordId,
    useResource: () => ({ resource: { id: 'def_line' } }),
    useResourceFields: () => ({
      fields: [
        {
          id: 'fld_photos',
          key: 'photos',
          options: { file: { allowMultiple: true, allowedFileTypes: ['image'] } },
        },
      ],
    }),
  }
})
vi.mock('~/components/resources/store/resource-store', () => {
  const storeState = {
    resourceMap: new Map(),
    definitionIdByPrefix: new Map(),
    fieldMap: {},
    systemAttributeMap: {},
    systemAttributeByDef: {},
    ambiguousSystemAttributes: new Set(),
    getResourceById: () => undefined,
  }
  const useResourceStore = (select: (s: typeof storeState) => unknown) => select(storeState)
  useResourceStore.getState = () => storeState
  useResourceStore.subscribe = () => () => {}
  return { useResourceStore }
})
vi.mock('~/components/resources/hooks/use-system-values', () => ({
  useSystemValues: () => ({ values: {}, isLoading: false }),
}))
vi.mock('~/components/resources/hooks/use-save-field-value', () => ({
  useSaveFieldValue: () => ({ saveFieldValue: vi.fn(), saveMultipleAsync: vi.fn() }),
}))
vi.mock('~/components/money/hooks/use-catalog-parts', () => ({
  useCatalogParts: () => ({ parts: [], partMap: new Map(), isLoading: false }),
}))
vi.mock('~/components/money/hooks/use-catalog-groups', () => ({
  useCatalogGroups: () => ({ groups: [], isLoading: false }),
}))
vi.mock('~/components/resources/store/field-value-fetch-queue', () => ({
  fieldValueFetchQueue: { queueFetch: h.queueFetch },
}))
vi.mock('~/hooks/use-settings', () => ({ useSettings: () => ({ getSetting: () => null }) }))

function line(overrides: Partial<Line>): Line {
  return {
    id: 'line_1',
    documentType: 'quote',
    documentId: 'q1',
    sortOrder: 0,
    name: 'Widget',
    qty: 1,
    photos: [],
    ...overrides,
  } as Line
}

describe('LinePhotoPopover in the builder', () => {
  beforeEach(() => {
    useUploadStore.getState().reset()
    useFieldValueStore.getState().clearAll()
    useUploadStore.getState().setTransport(createFakeUploadTransport())
    h.add.mockReset()
    h.add.mockImplementation(async (input: { value: { value: { ref: string } } }) => ({
      id: 'fv_new',
      type: 'json',
      value: { ref: input.value.value.ref },
    }))
    h.lines = [line({ photos: [{ ref: 'asset:existing' }] })]
    // The server answer for the line's photos field: the one photo it already has.
    h.queueFetch.mockImplementation((recordId, fieldRef) => {
      const { key } = buildCanonicalFieldValueKey(recordId, fieldRef)
      useFieldValueStore
        .getState()
        .setValue(key, [{ id: 'fv_existing', type: 'json', value: { ref: 'asset:existing' } }])
    })
    getFileRefStoreState().completeBatch(
      [{ ref: 'asset:existing', name: 'old.png', mimeType: 'image/png', size: 4 }],
      ['asset:existing']
    )
  })

  it('shows the line\u2019s photos, then the uploaded one in place of its uploading tile', async () => {
    render(
      <TooltipProvider>
        <LineBuilder documentRecordId='def_quote:q1' documentType='quote' />
      </TooltipProvider>
    )
    fireEvent.click(screen.getByText('1'))
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(1))
    fireEvent.click(screen.getByText('Upload'))

    const input = await waitFor(() => {
      const el = document.body.querySelector<HTMLInputElement>('input[type=file]')
      if (!el) throw new Error('picker not open')
      return el
    })
    const file = new File([new Uint8Array(4)], 'a.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => {
      await (input.onchange as (e: Event) => Promise<void>)(new Event('change'))
    })

    await waitFor(() => expect(h.add).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(2))
    expect(screen.queryByText('100%')).toBeNull()
  })
})
