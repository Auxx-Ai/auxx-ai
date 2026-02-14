// apps/web/src/components/dynamic-table/stores/dynamic-table-store.ts
'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { createFilterSlice } from './filter-slice'
import { createSharedSlice } from './shared-slice'
import type { DynamicTableStore } from './store-types'
import { createUISlice } from './ui-slice'
import { createViewSlice } from './view-slice'

/** Combined dynamic table store using slice pattern */
export const useDynamicTableStore = create<DynamicTableStore>()(
  subscribeWithSelector(
    immer((...a) => ({
      ...createViewSlice(...a),
      ...createUISlice(...a),
      ...createFilterSlice(...a),
      ...createSharedSlice(...a),
    }))
  )
)

// Re-export types
export type { DynamicTableStore, TableUIConfig } from './store-types'
