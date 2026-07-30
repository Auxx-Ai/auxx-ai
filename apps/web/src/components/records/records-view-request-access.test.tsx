// apps/web/src/components/records/records-view-request-access.test.tsx
//
// Plan v3/04 §8.5 at the **TABLE** — the performance-sensitive surface, and the
// one mount 3 lands in.
//
// `_access === 'read'` is the COMMON rung, so on a real table every row is
// mount-3-eligible. What makes that free is that Radix does not mount
// `DropdownMenuContent`'s subtree until the menu opens: the only per-row work is
// the `rowRung(row) === 'read'` store read the Share item already pays for.
//
// The regression this pins is not "a query fired". It is **"the popover's body
// ran at all"** — someone adds `forceMount` to make the menu animate, or hoists
// the hook out of the item "for reuse", and 25 rows become 25 hooks before a
// single query is even considered. So the strong assertion here is a render
// counter on `RecordRequestAccessPopover`, with the preflight count beside it.
//
// The harness is the narrowest one that runs the SHIPPED `primaryCellRender`:
// `DynamicResourceView` is stubbed to a component that hands each row to the
// real render function, so the cell (`PrimaryFieldCell` → `PrimaryCell` →
// `DropdownMenu`) and the mount-3 branch are the ones records-view actually
// exports. Only the table's data plumbing and virtualization are replaced —
// neither is what is under test, and re-implementing the menu here instead
// would pass vacuously.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const DEF = 'edf_ticket0000000000000000000'
const FIELD = 'fld_name00000000000000000000'
const ROW_COUNT = 25
const rowId = (i: number) => `ein_row${String(i).padStart(21, '0')}`

const h = vi.hoisted(() => ({
  /** Every input `recordAccessRequestPreflight` was ENABLED for. */
  preflightCalls: [] as unknown[],
  /** How many times the mount-3 popover's BODY rendered. */
  popoverRenders: 0,
}))

// ── the two counters ─────────────────────────────────────────────────────────
vi.mock('~/components/permissions/ui/record-request-access-popover', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('~/components/permissions/ui/record-request-access-popover')
    >()
  return {
    // Wraps rather than replaces: the REAL popover still renders (and still
    // drives the preflight) once the dropdown mounts it, so this counts the
    // shipped body's executions instead of standing in for it.
    RecordRequestAccessPopover: (
      props: React.ComponentProps<typeof actual.RecordRequestAccessPopover>
    ) => {
      h.popoverRenders += 1
      return <actual.RecordRequestAccessPopover {...props} />
    },
  }
})

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({ approval: { recordAccessRequestPreflight: { invalidate: vi.fn() } } }),
    approval: {
      recordAccessRequestPreflight: {
        useQuery: (input: unknown, opts: { enabled: boolean }) => {
          if (opts.enabled) h.preflightCalls.push(input)
          return {
            data: opts.enabled
              ? {
                  eligible: true,
                  currentRung: 'read',
                  requestedRung: 'edit',
                  pending: null,
                  approvers: [],
                  subjectLabel: 'Ticket',
                  refusalReason: null,
                }
              : undefined,
            isLoading: false,
          }
        },
      },
      requestRecordAccess: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      withdrawAccessRequest: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}))

// ── the harness: the SHIPPED `primaryCellRender`, over a list ────────────────
vi.mock('~/components/dynamic-table/dynamic-resource-view', () => ({
  DynamicResourceView: ({
    primaryCellRender,
  }: {
    primaryCellRender: (row: { id: string; _access: string }) => React.ReactNode
  }) => (
    <div>
      {Array.from({ length: ROW_COUNT }, (_, i) => (
        <div key={rowId(i)} data-testid={`row-${i}`}>
          {/* Every row is `read`, i.e. every row is mount-3 eligible. */}
          {primaryCellRender({ id: rowId(i), _access: 'read' })}
        </div>
      ))}
    </div>
  ),
}))

// ── everything records-view hangs off that this property does not touch ──────
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({
    canEditEntity: () => false,
    canAdministerDef: () => false,
    // Def rung `none`, so an UNSTAMPED row would not be eligible — every
    // eligible row below is eligible because of its own `_access` stamp.
    recordDefRung: () => 'none',
    canDeleteRecordAt: () => false,
  }),
}))
vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => true }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('nuqs', () => ({
  useQueryState: (_key: string, opts?: { defaultValue?: unknown }) => [
    opts?.defaultValue ?? null,
    vi.fn(),
  ],
  parseAsBoolean: { withDefault: (d: unknown) => ({ defaultValue: d }) },
  parseAsString: { withDefault: (d: unknown) => ({ defaultValue: d }) },
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('~/components/dynamic-table/hooks/use-table-view-realtime', () => ({
  useTableViewRealtime: () => {},
}))
vi.mock('~/hooks/use-entity-instance-operations', () => ({
  useEntityInstanceOperations: () => ({
    handleArchive: vi.fn(),
    handleDelete: vi.fn(),
    handleDrawerDelete: vi.fn(),
    handleBulkDelete: vi.fn(),
    handleBulkArchive: vi.fn(),
    ConfirmDeleteDialog: () => null,
    ConfirmArchiveDialog: () => null,
  }),
}))
vi.mock('~/hooks/use-docked-panels', () => ({ useDockedPanels: () => [] }))
vi.mock('~/components/resources/hooks/run-ai-bulk-generate', () => ({
  useRunAiBulkGenerate: () => ({ run: vi.fn() }),
}))
vi.mock('~/components/resources/hooks/use-save-field-value', () => ({
  useSaveFieldValue: () => ({ saveFieldValue: vi.fn() }),
}))
vi.mock('./record-drawer', () => ({ RecordDrawer: () => null }))
vi.mock('./records-searchbar', () => ({ RecordsSearchBar: () => null }))
vi.mock('~/components/records/record-editor-dialog', () => ({ RecordEditorDialog: () => null }))
vi.mock('~/components/permissions/ui/instance-share-dialog', () => ({
  InstanceShareDialog: () => null,
}))
vi.mock('~/components/merge', () => ({ MergeDialog: () => null }))
vi.mock('~/components/custom-fields/ui/bulk-update-entity-instance-dialog', () => ({
  BulkUpdateEntityInstanceDialog: () => null,
}))
vi.mock('~/components/data-export/ui/export-progress-dialog', () => ({
  ExportProgressDialog: () => null,
}))
vi.mock('~/components/print/ui/print-wizard-dialog', () => ({ PrintWizardDialog: () => null }))
vi.mock('~/components/sequences/ui/add-to-sequence-dialog', () => ({
  AddToSequenceDialog: () => null,
}))
vi.mock('~/components/workflow/mass-workflow-trigger-dialog', () => ({
  MassWorkflowTriggerDialog: () => null,
}))
vi.mock('~/components/kopilot/context', () => ({ KopilotContext: () => null }))
vi.mock('~/components/kbar/contextual', () => ({
  CommandAction: () => null,
  CommandContext: () => null,
}))
vi.mock('~/components/global/empty-state', () => ({ EmptyState: () => null }))
vi.mock('~/components/global/main-page-states', () => ({
  MainPageLoading: () => null,
  MainPageNotFound: () => null,
}))
vi.mock('@auxx/ui/components/main-page', () => ({ MainPageAction: () => null }))
vi.mock('~/components/favorites/ui/favorite-toggle-menu-item', () => ({
  FavoriteToggleMenuItem: () => null,
}))
// PrimaryFieldCell's own leaves — the cell itself, its kebab and its dropdown
// stay REAL, because they are the mechanism under test.
vi.mock('~/components/fields/connector-source-badge', () => ({ ConnectorSourceBadge: () => null }))
vi.mock('~/components/resources/ui/record-icon', () => ({ RecordIcon: () => null }))
vi.mock('~/components/resources/hooks/use-field-values', () => ({
  useFieldValue: (_recordId: string, fieldId: string) => ({
    value: fieldId ? 'ACME' : undefined,
    isLoading: false,
  }),
}))
vi.mock('~/components/resources/hooks/use-field', () => ({
  useField: () => ({ id: FIELD, fieldType: 'TEXT' }),
}))

const RESOURCE = {
  id: DEF,
  entityDefinitionId: DEF,
  type: 'custom',
  entityType: 'custom',
  apiSlug: 'tickets',
  label: 'Ticket',
  plural: 'Tickets',
  fields: [{ id: FIELD, name: 'Name', fieldType: 'TEXT' }],
  display: { primaryDisplayField: { id: FIELD, name: 'Name', type: 'TEXT' } },
}

vi.mock('~/components/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/components/resources')>()
  return {
    ...actual,
    useResource: () => ({ resource: RESOURCE, isLoading: false }),
    useRecord: () => ({ record: null, isLoading: false }),
    resourceHasDetailPage: () => false,
  }
})

const { useRecordStore } = await import('~/components/resources/store/record-store')
const { RecordsView } = await import('./records-view')

beforeAll(() => {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
})

beforeEach(() => {
  h.preflightCalls = []
  h.popoverRenders = 0
  // Stamp the store the way `record.getByIds` does for a loaded page: every one
  // of the 25 rows at `read`, so every one is mount-3 eligible on BOTH reads —
  // the table's `rowRung(row)` and the popover hook's `useRecordAccessFor`.
  useRecordStore.setState({ records: {}, attemptedIds: new Set() })
  useRecordStore.getState().setRecords(
    DEF,
    Array.from({ length: ROW_COUNT }, (_, i) => ({
      id: rowId(i),
      createdAt: new Date(),
      updatedAt: new Date(),
      _access: 'read' as const,
    }))
  )
})

describe('mount 3 in the records table (§8.5)', () => {
  it('25 eligible rows cost ZERO preflights and mount ZERO popovers (§8.5)', async () => {
    render(<RecordsView slug='tickets' />)

    // Every row rendered, and every one of them reached the kebab — i.e. the
    // cell's children (which is where the mount-3 branch lives) were built 25
    // times. Without this the counters below could pass vacuously.
    expect(screen.getAllByTestId(/^row-/)).toHaveLength(ROW_COUNT)
    expect(document.querySelectorAll('button[aria-haspopup="menu"]')).toHaveLength(ROW_COUNT)

    // 🔴 The strong assertion: the popover's body never ran. A `forceMount` on
    // `DropdownMenuContent`, or a hook hoisted out of the menu item, breaks
    // THIS long before it breaks the query count.
    expect(h.popoverRenders).toBe(0)
    expect(h.preflightCalls).toHaveLength(0)

    // …and it stays that way once effects and microtasks have settled.
    await Promise.resolve()
    expect(h.popoverRenders).toBe(0)
    expect(h.preflightCalls).toHaveLength(0)
  })

  it('opening ONE row’s dropdown mounts one popover; the other 24 stay silent', async () => {
    render(<RecordsView slug='tickets' />)

    const kebabs = Array.from(
      document.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]')
    )
    // One kebab per row, and the dropdown subtree is unmounted behind each.
    expect(kebabs).toHaveLength(ROW_COUNT)

    await userEvent.click(kebabs[0] as HTMLElement)

    // ONE row's menu is open, so ONE popover body ran — not 25.
    expect(await screen.findByRole('menuitem', { name: 'Request edit access' })).toBeInTheDocument()
    expect(h.popoverRenders).toBeGreaterThan(0)
    // Mounting the item is still not asking: the preflight waits for the popover.
    expect(h.preflightCalls).toHaveLength(0)

    await userEvent.click(screen.getByRole('menuitem', { name: 'Request edit access' }))

    // Exactly one row paid, and it is the row whose menu was opened.
    expect(h.preflightCalls).toEqual([{ entityDefinitionId: DEF, entityInstanceId: rowId(0) }])
    // The other 24 never rendered a menu item, let alone a query.
    expect(screen.getAllByRole('menuitem', { name: 'Request edit access' })).toHaveLength(1)
  })
})
