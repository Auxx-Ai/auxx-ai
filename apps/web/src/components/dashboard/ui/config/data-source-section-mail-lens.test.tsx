// apps/web/src/components/dashboard/ui/config/data-source-section-mail-lens.test.tsx
//
// Half two of the config gate (see `widget-config-mail-source.test.tsx` for half
// one): `excludeMailLensTables` — and the aggregate allowlist mirror behind it —
// actually removes `thread` / `message` from what the source picker offers.
//
// Separate file because the sibling stubs `./data-source-section` to read the
// prop off each body, which would stub the component under test here.

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Props every `ResourcePicker` mount received. */
  pickers: [] as Array<{ excludeIds?: string[] }>,
}))

vi.mock('~/components/pickers/resource-picker/resource-picker', () => ({
  ResourcePicker: (props: { excludeIds?: string[] }) => {
    h.pickers.push(props)
    return <div data-testid='resource-picker' />
  },
}))

/** Registry system tables + a custom entity def, in the `useResources` shape. */
const RESOURCES = [
  { id: 'thread', type: 'system' },
  { id: 'message', type: 'system' },
  { id: 'article', type: 'system' },
  { id: 'user', type: 'system' },
  { id: 'edf_contact', type: 'custom' },
]

vi.mock('~/components/resources', () => ({
  useResources: () => ({ resources: RESOURCES, getResourceById: () => undefined }),
}))

import { MAIL_LENS_SOURCE_IDS, SYSTEM_AGGREGATE_SOURCE_IDS } from '../../lib/widget-source'
import { DataSourceSection } from './data-source-section'

/** `TooltipProvider` mirrors the app shell (`global/auxx-app-providers.tsx`) — a
 *  `FieldPanelRow` label carries a Radix tooltip. */
const renderSection = (props: { excludeMailLensTables?: boolean } = {}) =>
  render(
    <TooltipProvider>
      <DataSourceSection
        source={undefined}
        hasDependentConfig={false}
        onSelectSource={() => {}}
        {...props}
      />
    </TooltipProvider>
  )

beforeEach(() => {
  h.pickers.length = 0
})

describe('DataSourceSection', () => {
  it('excludes thread and message when the flag is set', () => {
    renderSection({ excludeMailLensTables: true })

    expect(screen.getByTestId('resource-picker')).toBeInTheDocument()
    for (const id of MAIL_LENS_SOURCE_IDS) {
      expect(h.pickers[0]?.excludeIds).toContain(id)
    }
  })

  it('still offers the aggregate-queryable system tables and entity defs', () => {
    renderSection({ excludeMailLensTables: true })

    // Without this the assertion above would also pass on a picker that
    // excluded literally everything.
    expect(h.pickers[0]?.excludeIds).not.toContain('article')
    expect(h.pickers[0]?.excludeIds).not.toContain('edf_contact')
    // A system table the aggregate engine cannot query stays hidden, as before.
    expect(h.pickers[0]?.excludeIds).toContain('user')
  })

  it('excludes them even with the flag unset — the aggregate mirror dropped them', () => {
    // Defence in depth, and the drift this file exists to catch: the server
    // removed `thread` / `message` from `SYSTEM_AGGREGATE_TABLE_IDS` while this
    // client-side mirror still listed them, so the chart bodies kept offering a
    // source that could only ever 403.
    renderSection()

    for (const id of MAIL_LENS_SOURCE_IDS) {
      expect(h.pickers[0]?.excludeIds).toContain(id)
    }
  })
})

describe('the client-side aggregate mirror', () => {
  it('is disjoint from the mail tables', () => {
    // The server asserts the same disjointness over its own two constants in
    // `resources/aggregate/mail-lens-refusal.test.ts`; this is that assertion on
    // the copy the config panel actually reads.
    for (const id of MAIL_LENS_SOURCE_IDS) {
      expect(SYSTEM_AGGREGATE_SOURCE_IDS as readonly string[]).not.toContain(id)
    }
  })
})
