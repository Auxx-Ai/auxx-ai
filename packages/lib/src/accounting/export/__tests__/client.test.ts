// packages/lib/src/accounting/export/__tests__/client.test.ts

import { describe, expect, it } from 'vitest'
import {
  EXPORT_BATCH_TABS,
  type ExportBatchState,
  exportBatchStateLabel,
  exportBatchTabAdmits,
  OUTBOX_TABS,
  parseOutboxTab,
} from '../client'

describe('the outbox tabs (75-D6)', () => {
  it('has no sending tab', () => {
    expect(EXPORT_BATCH_TABS).toEqual(['ready', 'sent', 'failed'])
    expect(OUTBOX_TABS).toEqual(['blocked', 'ready', 'sent', 'failed'])
  })

  it('keeps `sending` a state, with its own label', () => {
    expect(exportBatchStateLabel('sending')).toBe('Sending')
  })

  it('lists a sending batch under Ready, and nowhere else', () => {
    expect(exportBatchTabAdmits('ready', 'sending')).toBe(true)
    expect(exportBatchTabAdmits('ready', 'ready')).toBe(true)
    expect(exportBatchTabAdmits('sent', 'sending')).toBe(false)
    expect(exportBatchTabAdmits('failed', 'sending')).toBe(false)
  })

  it('counts a sending batch in the Ready tab', () => {
    const states: ExportBatchState[] = ['ready', 'sending', 'sent', 'failed', 'withdrawn']
    const count = states.filter((state) => exportBatchTabAdmits('ready', state)).length
    expect(count).toBe(2)
  })

  it('never admits a withdrawn batch onto a tab', () => {
    for (const tab of EXPORT_BATCH_TABS) {
      expect(exportBatchTabAdmits(tab, 'withdrawn')).toBe(false)
    }
  })
})

describe('parseOutboxTab', () => {
  it('falls a pasted ?queue=sending link back to Ready', () => {
    expect(parseOutboxTab('sending')).toBe('ready')
  })

  it('passes a live tab through', () => {
    for (const tab of OUTBOX_TABS) expect(parseOutboxTab(tab)).toBe(tab)
  })

  it('is null for an absent param, so the outbox stays closed', () => {
    expect(parseOutboxTab(null)).toBeNull()
    expect(parseOutboxTab(undefined)).toBeNull()
    expect(parseOutboxTab('')).toBeNull()
  })
})
