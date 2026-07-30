// apps/web/src/components/records/record-drawer-request-access.test.tsx
//
// Plan v3/04 §11's non-negotiable case: **render the drawer for a `read`-only
// member and assert ZERO `recordAccessRequestPreflight` calls until the popover
// opens** (§8.5 / D6).
//
// This is the one behaviour a later refactor reintroduces silently, because
// nothing about an eager query looks wrong in review. `_access === 'read'` is the
// COMMON state — every member with def-level Read on a def they cannot edit — so
// an eager preflight would fire on every drawer open for that whole population,
// to decide a button's wording.
//
// The drawer is rendered for real (its header slot, its gate, the wrapper, the
// hook); only the subtrees with nothing to do with the gate are stubbed.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const DEF = 'edf_ticket0000000000000000000'
const ROW = 'ein_row000000000000000000000'
const RECORD_ID = `${DEF}:${ROW}`

const h = vi.hoisted(() => ({
  /** Every input the preflight was ENABLED for — the assertion target. */
  preflightCalls: [] as unknown[],
  /** The drawer's own view of the row, which decides whether the mount renders. */
  access: 'read' as 'none' | 'read' | 'edit' | 'admin',
}))

// ── the gate's own inputs, real ───────────────────────────────────────────────
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ recordDefRung: () => 'none', canDeleteRecordAt: () => false }),
}))
vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => true }),
}))
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
                  subjectLabel: 'Ticket · ACME onboarding',
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

// ── everything the drawer hangs off that this gate does not touch ─────────────
vi.mock('~/components/drawers/base-entity-drawer', () => ({
  BaseEntityDrawer: ({ headerActions }: { headerActions?: React.ReactNode }) => (
    <div>{headerActions}</div>
  ),
}))
vi.mock('~/components/drawers/drawer-action-registry', () => ({ getHeaderActions: () => [] }))
vi.mock('~/components/kbar/contextual', () => ({
  CommandContext: () => null,
  RecordCommandActions: () => null,
}))
vi.mock('~/components/kopilot/context', () => ({ KopilotContext: () => null }))
vi.mock('~/components/kopilot/suggestions', () => ({ KopilotSuggestion: () => null }))
vi.mock('~/components/merge', () => ({ MergeDialog: () => null }))
vi.mock('~/components/permissions/ui/instance-share-dialog', () => ({
  InstanceShareDialog: () => null,
}))
vi.mock('~/components/records/record-editor-dialog', () => ({ RecordEditorDialog: () => null }))
vi.mock('~/components/workflow/manual-trigger-button', () => ({ ManualTriggerButton: () => null }))
vi.mock('~/components/favorites/ui/favorite-toggle-menu-item', () => ({
  FavoriteToggleMenuItem: () => null,
}))
vi.mock('~/components/fields/connector-source-badge', () => ({ ConnectorSourceBadge: () => null }))
vi.mock('~/components/resources/ui/avatar-upload-icon', () => ({ AvatarUploadIcon: () => null }))
vi.mock('~/components/resources/ui/record-icon', () => ({ RecordIcon: () => null }))
vi.mock('~/components/resources/hooks/use-field-values', () => ({
  useFieldValue: () => ({ value: undefined }),
}))
vi.mock('~/components/resources', () => ({
  resourceHasDetailPage: () => false,
  useRecord: () => ({ record: null, isLoading: false }),
  useResource: () => ({
    resource: {
      id: DEF,
      type: 'custom',
      entityType: 'custom',
      label: 'Ticket',
      apiSlug: 'tickets',
      fields: [],
      display: { primaryDisplayField: null, secondaryDisplayField: null, avatarField: null },
    },
  }),
  // The drawer's OWN read of the row. The popover's hook reads the store through
  // the deep path, so this stub cannot short-circuit the lazy gate under test.
  useRecordAccess: () => ({
    access: h.access,
    canEdit: false,
    canDelete: false,
    canShare: false,
  }),
}))
vi.mock('./use-record-drawer-read-only', () => ({ useRecordDrawerReadOnly: () => true }))
vi.mock('~/hooks/use-confirm', () => ({ useConfirm: () => [vi.fn(), () => null] }))
vi.mock('~/hooks/use-effective-dock-state', () => ({ useEffectiveDockState: () => false }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('~/components/global/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}))

const { useRecordStore } = await import('~/components/resources/store/record-store')
const { RecordDrawer } = await import('./record-drawer')

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
  h.access = 'read'
  useRecordStore.setState({ records: {}, attemptedIds: new Set() })
  useRecordStore
    .getState()
    .setRecords(DEF, [{ id: ROW, createdAt: new Date(), updatedAt: new Date(), _access: 'read' }])
})

describe('the drawer header pays NOTHING to render the request trigger (§8.5 / D6)', () => {
  it('fires no preflight on open, and exactly one when the popover is opened', async () => {
    render(<RecordDrawer open recordId={RECORD_ID as never} />)

    const trigger = screen.getByRole('button', { name: 'Request edit access' })
    expect(h.preflightCalls).toHaveLength(0)

    await userEvent.click(trigger)
    expect(h.preflightCalls).toEqual([{ entityDefinitionId: DEF, entityInstanceId: ROW }])
  })

  it('does not mount the trigger at all for an `edit` row — and still asks nothing', () => {
    h.access = 'edit'
    render(<RecordDrawer open recordId={RECORD_ID as never} />)

    expect(screen.queryByRole('button', { name: /Request/ })).not.toBeInTheDocument()
    expect(h.preflightCalls).toHaveLength(0)
  })
})
