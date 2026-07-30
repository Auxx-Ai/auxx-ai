// apps/web/src/components/permissions/ui/grantee-add-panel.test.tsx

import type { ActorId } from '@auxx/types/actor'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The staged add flow, and specifically the two things whose failure mode is a
 * WRONG NOTIFICATION rather than a visible defect.
 *
 * `grantInstanceAccess` gates its share notification on `xmax = 0` — insert
 * only. So the level carried by the FIRST write is the level the recipient is
 * told about, permanently: a later downgrade is an `ON CONFLICT UPDATE` and
 * notifies nobody. That makes two asserts load-bearing, and both of them pass
 * vacuously if written loosely:
 *
 *  - **Picking writes nothing.** `expect(onGrant).not.toHaveBeenCalled()` after
 *    selecting. This is the whole bug; delete the staging and it fails.
 *  - **Submit writes the CHOSEN level, not `defaultChoice`.** A test that only
 *    asserts "onGrant was called" passes with the bug fully intact, because the
 *    old code called it too — just with `'full'` at the wrong moment.
 */

const h = vi.hoisted(() => ({
  /** Actors the fake picker offers. */
  available: [
    { actorId: 'user:u_sarah' as ActorId, name: 'Sarah Chen' },
    { actorId: 'user:u_ben' as ActorId, name: 'Ben Ortiz' },
    { actorId: 'group:g_support' as ActorId, name: 'Support team' },
  ],
  /** `excludeIds` the panel handed the picker on its last render. */
  lastExcludeIds: [] as ActorId[],
}))

// The real content queries tRPC and the actor store. Stub it down to what the
// panel's contract actually is: a multi-select over ActorIds.
vi.mock('~/components/pickers/actor-picker', () => ({
  ActorPickerContent: ({
    value,
    onChange,
    excludeIds = [],
  }: {
    value: ActorId[]
    onChange: (next: ActorId[]) => void
    excludeIds?: ActorId[]
  }) => {
    h.lastExcludeIds = excludeIds
    return (
      <div>
        {h.available
          .filter((a) => !excludeIds.includes(a.actorId))
          .map((a) => (
            <button
              key={a.actorId}
              type='button'
              onClick={() =>
                onChange(
                  value.includes(a.actorId)
                    ? value.filter((v) => v !== a.actorId)
                    : [...value, a.actorId]
                )
              }>
              {a.name}
            </button>
          ))}
      </div>
    )
  },
}))

vi.mock('~/components/resources/hooks/use-actor', () => ({
  useActor: ({ actorId }: { actorId?: ActorId }) => ({
    actor: actorId
      ? { actorId, type: actorId.startsWith('group:') ? 'group' : 'user', name: 'Existing person' }
      : undefined,
    isLoading: false,
    isNotFound: false,
  }),
}))

// `LensSelect` opens an upgrade dialog for sub-`full` tiers when the org lacks
// the feature — ungated here so the tier change under test actually lands.
vi.mock('~/components/mail-permissions/ui/enterprise-gate', () => ({
  useMailPermissionsGated: () => false,
  MailPermissionsUpgradeDialog: () => null,
}))

const { MailGranteeList } = await import('~/components/mail-permissions/ui/mail-grantee-list')

beforeAll(() => {
  // `CommandBreadcrumb`'s ScrollArea and Radix Select's `autoUpdate` both
  // CONSTRUCT observers; the global setup stubs ones that cannot be `new`ed.
  // Same pattern as `request-access-popover.test.tsx`.
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoopObserver)
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
  Element.prototype.scrollIntoView = () => {}
})

const onGrant = vi.fn()
const onChangeLens = vi.fn()
const onRevoke = vi.fn()

function renderList(
  grants: Array<{ actorId: ActorId; choice: 'full' | 'subject' | 'metadata' }> = []
) {
  // The grantee rows' remove button is a tooltip trigger — Radix throws without
  // a provider, which the app supplies globally.
  return render(
    <TooltipProvider>
      <MailGranteeList
        grants={grants}
        onGrant={onGrant}
        onChangeLens={onChangeLens}
        onRevoke={onRevoke}
        stagedAdd
      />
    </TooltipProvider>
  )
}

/** Open the drill-down page. */
async function openAddPage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /add people or groups/i }))
}

/** Pick the batch tier from the panel's `LensSelect`. */
async function selectTier(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getByRole('combobox'))
  await user.click(screen.getByRole('option', { name: label }))
}

describe('staged grantee add', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.lastExcludeIds = []
  })

  it('writes nothing when an actor is picked — only submit persists', async () => {
    const user = userEvent.setup()
    renderList()
    await openAddPage(user)

    await user.click(screen.getByRole('button', { name: 'Sarah Chen' }))
    await user.click(screen.getByRole('button', { name: 'Ben Ortiz' }))

    // The entire bug: the old flow had already granted Full to both by now, and
    // notified them, before the admin ever saw the tier control.
    expect(onGrant).not.toHaveBeenCalled()
  })

  it('submits at the chosen level, not the default', async () => {
    const user = userEvent.setup()
    renderList()
    await openAddPage(user)

    await user.click(screen.getByRole('button', { name: 'Sarah Chen' }))
    await selectTier(user, /subject only/i)
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    // `defaultChoice` for mail is 'full'. Asserting only "was called" would pass
    // against the bug.
    expect(onGrant).toHaveBeenCalledTimes(1)
    expect(onGrant).toHaveBeenCalledWith('user:u_sarah', 'subject')
  })

  it('grants every selected actor at the same chosen level', async () => {
    const user = userEvent.setup()
    renderList()
    await openAddPage(user)

    await user.click(screen.getByRole('button', { name: 'Sarah Chen' }))
    await user.click(screen.getByRole('button', { name: 'Support team' }))
    await selectTier(user, /activity only/i)
    await user.click(screen.getByRole('button', { name: /add 2/i }))

    expect(onGrant.mock.calls).toEqual([
      ['user:u_sarah', 'metadata'],
      ['group:g_support', 'metadata'],
    ])
  })

  it('returns to the list on submit', async () => {
    const user = userEvent.setup()
    renderList()
    await openAddPage(user)
    await user.click(screen.getByRole('button', { name: 'Sarah Chen' }))
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    expect(screen.getByRole('button', { name: /add people or groups/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sarah Chen' })).not.toBeInTheDocument()
  })

  it('discards the selection on cancel', async () => {
    const user = userEvent.setup()
    renderList()
    await openAddPage(user)
    await user.click(screen.getByRole('button', { name: 'Sarah Chen' }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onGrant).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /add people or groups/i })).toBeInTheDocument()
  })

  it('cannot submit an empty selection', async () => {
    const user = userEvent.setup()
    renderList()
    await openAddPage(user)

    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
  })

  it('excludes existing grantees from the picker', async () => {
    const user = userEvent.setup()
    renderList([{ actorId: 'user:u_sarah' as ActorId, choice: 'full' }])
    await openAddPage(user)

    expect(h.lastExcludeIds).toContain('user:u_sarah')
    expect(screen.queryByRole('button', { name: 'Sarah Chen' })).not.toBeInTheDocument()
  })
})
