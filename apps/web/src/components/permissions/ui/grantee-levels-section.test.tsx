// apps/web/src/components/permissions/ui/grantee-levels-section.test.tsx

import { Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 31 §2.4, phase 2's **areas half** — this section reads ONE grantee.
 *
 * It used to take a member's area levels out of `usePermissionGrants`, the
 * org-wide store that loads every grant row in the org, with
 * `persisted.find(g => g.granteeId === granteeId)?.levels`. Now they arrive
 * pre-scoped as `granteeAccess.own.areas`, and the *Inherit* fall-through as
 * `granteeAccess.baseline.areas`.
 *
 * The load-bearing part is not the read, it is the flush: `useGranteeAreaLevels`
 * lays the staged edits over that map and saves the whole thing, so a swap that
 * pointed the persisted half at `baseline.areas` would silently wipe every other
 * area the grantee holds. That is the test worth having here.
 *
 * Since the staged-edits change, clicking a rung writes nothing — the section
 * commits from its `FormSaveBar`, like the Profiles tab always did.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

const { granteeAccess, saveAsync, defAccess, instanceRows } = vi.hoisted(() => ({
  granteeAccess: { current: undefined as unknown },
  saveAsync: vi.fn(),
  defAccess: {
    isLoading: false,
    rows: [],
    setLevel: vi.fn(),
    isDirty: false,
    isSaving: false,
    save: async () => true,
    discard: () => {},
  },
  // One entry per `InstanceAccessKey`. `agent` joined the registry in the
  // 2026-07-28 agents slice, and because `AREA_TO_INSTANCE_KEY` is DERIVED from
  // that registry, the Agents area row immediately started nesting instance
  // rows — so a mock missing the key crashes on `instances[type].isLoading`
  // rather than merely under-covering. Adding an instance-access resource will
  // do this again; the fix is another entry here, not a guard in the component.
  instanceRows: {
    isLoading: false,
    lists: {
      dataset: { items: [], isLoading: false, truncated: false },
      kb: { items: [], isLoading: false, truncated: false },
      dashboard: { items: [], isLoading: false, truncated: false },
      workflow: { items: [], isLoading: false, truncated: false },
      agent: { items: [], isLoading: false, truncated: false },
      signature: { items: [], isLoading: false, truncated: false },
      snippet: { items: [], isLoading: false, truncated: false },
      // `inbox` / `personal_inbox` joined in plan 40 phase 1 — see the note
      // above; the Inboxes area row nests instance rows the same way.
      inbox: { items: [], isLoading: false, truncated: false },
      personal_inbox: { items: [], isLoading: false, truncated: false },
    },
    rowsByKey: {
      dataset: [],
      kb: [],
      dashboard: [],
      workflow: [],
      agent: [],
      signature: [],
      snippet: [],
      inbox: [],
      personal_inbox: [],
    },
    setGrant: vi.fn(),
    isDirty: false,
    isSaving: false,
    save: async () => true,
    discard: () => {},
  },
}))

const ROLE_DEFAULTS = Object.fromEntries(
  Object.keys(PERMISSION_AREAS).map((area) => [area, Level.None])
) as Record<Area, Level>

vi.mock('../hooks/use-grantee-access', () => ({
  useGranteeAccess: () => granteeAccess.current,
}))
// `useGranteeAreaLevels` is deliberately NOT mocked — the staging it does is the
// subject of the flush test below. Only the write it reaches for is.
vi.mock('../hooks/use-permission-grants', () => ({
  useGrantWrites: () => ({ saveAsync, isSaving: false }),
  useRoleDefaults: () => ({ roleDefaults: ROLE_DEFAULTS, isLoading: false }),
}))
vi.mock('../hooks/use-grantee-def-access', () => ({
  useGranteeDefAccess: () => defAccess,
}))
vi.mock('../hooks/use-instance-grantee-rows', () => ({
  useInstanceGranteeRows: () => instanceRows,
}))
vi.mock('~/components/global/settings-page', () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const { GranteeLevelsSection } = await import('./grantee-levels-section')

const GRANTEE = 'usr_alice'
const FILES_LABEL = PERMISSION_AREAS[Area.files].label

function setup(payload: {
  own?: Partial<Record<Area, Level>>
  baseline?: Partial<Record<Area, Level>>
  effective?: Partial<Record<Area, Level>>
}) {
  granteeAccess.current = {
    isLoading: false,
    own: { areas: payload.own ?? {}, defs: {}, instances: {} },
    baseline: { areas: payload.baseline ?? {}, defs: {}, instances: {} },
    effective: payload.effective
      ? { areas: payload.effective, defs: {}, instances: {}, instanceFallback: {} }
      : null,
  }
  return render(
    <TooltipProvider>
      <GranteeLevelsSection granteeKind='user' granteeId={GRANTEE} canEdit />
    </TooltipProvider>
  )
}

/**
 * One area's row. The label appears twice — once as its group's uppercase
 * header, once as the row title — so the header is filtered out by class, then
 * we walk up to the nearest ancestor that actually holds a ladder.
 */
function areaRow(areaLabel: string): HTMLElement {
  const title = screen.getAllByText(areaLabel).find((el) => !el.className.includes('uppercase'))
  if (!title) throw new Error(`no row titled ${areaLabel}`)
  let node: HTMLElement | null = title.parentElement
  while (node && !node.querySelector('[role="radio"]')) node = node.parentElement
  if (!node) throw new Error(`no ladder under ${areaLabel}`)
  return node
}

/** One rung of that row's ladder — the radio itself, which carries the state. */
function rung(areaLabel: string, label: string): HTMLElement {
  const match = Array.from(areaRow(areaLabel).querySelectorAll('label')).find(
    (el) => el.textContent === label
  )
  const radio = match?.querySelector('[role="radio"]')
  if (!radio) throw new Error(`no "${label}" rung under ${areaLabel}`)
  return radio as HTMLElement
}

/** The `FormSaveBar`'s Save button — absent entirely while nothing is staged. */
function saveButton(): HTMLElement | undefined {
  return screen.queryAllByRole('button').find((el) => el.textContent === 'Save')
}

beforeEach(() => {
  saveAsync.mockReset()
  saveAsync.mockResolvedValue(undefined)
})

describe('the ladder reads the grantee-scoped payload', () => {
  it("shows the grantee's own rung, not the workspace baseline's", () => {
    setup({ own: { [Area.files]: Level.Full }, baseline: { [Area.files]: Level.Read } })

    // `aria-checked` is the ladder's own statement of which rung is selected.
    expect(rung(FILES_LABEL, 'Full').getAttribute('aria-checked')).toBe('true')
    expect(rung(FILES_LABEL, 'Read').getAttribute('aria-checked')).toBe('false')
  })

  it('renders the effective line off the composed half', () => {
    setup({ own: {}, baseline: {}, effective: { [Area.workflows]: Level.Edit } })

    // A member raised into Workflows by a team: the ladder says No access, the
    // composed answer says Edit, and the row now says both.
    expect(screen.getByText('Effective · Edit')).toBeTruthy()
  })
})

describe('an area write keeps every other area the grantee holds', () => {
  /**
   * The clobber case. The flush lays the staged edits over `values` and saves the
   * whole map, so if the persisted half ever stopped being this grantee's own
   * areas — pointing at `baseline.areas`, or at an empty object while the query
   * was still settling — changing one area would silently revoke all the others.
   * Server-side there is no guard against it: `setGranteeLevels` stores the
   * sparse map verbatim.
   */
  it('saves the untouched areas alongside the changed one', async () => {
    setup({
      own: { [Area.files]: Level.Read, [Area.workflows]: Level.Edit },
      baseline: {},
    })

    fireEvent.click(rung(FILES_LABEL, 'Full'))
    const button = saveButton()
    if (!button) throw new Error('no Save button after staging an edit')
    await act(async () => {
      fireEvent.click(button)
    })

    expect(saveAsync).toHaveBeenCalledWith('user', GRANTEE, {
      [Area.files]: Level.Full,
      [Area.workflows]: Level.Edit,
    })
  })
})

/**
 * The staged-edits contract at the surface an admin actually touches. Before
 * this, clicking a rung wrote immediately — while the Profiles tab next door
 * drafted and saved from a bar. Same-looking controls, two commit models.
 */
describe('edits stage until the save bar is used', () => {
  it('writes nothing on a rung click, and shows the bar instead', () => {
    setup({ own: { [Area.files]: Level.Read }, baseline: {} })

    expect(saveButton()).toBeUndefined()

    fireEvent.click(rung(FILES_LABEL, 'Full'))

    expect(saveAsync).not.toHaveBeenCalled()
    expect(saveButton()).toBeTruthy()
    // The ladder still moves — it renders the staged value.
    expect(rung(FILES_LABEL, 'Full').getAttribute('aria-checked')).toBe('true')
  })

  it('takes the bar away again when the edit is undone by hand', async () => {
    setup({ own: { [Area.files]: Level.Read }, baseline: {} })

    fireEvent.click(rung(FILES_LABEL, 'Full'))
    expect(saveButton()).toBeTruthy()

    fireEvent.click(rung(FILES_LABEL, 'Read'))
    // `waitFor`, not a bare assertion: the bar is an `AnimatePresence` child, so
    // it stays mounted for the length of its exit spring after going clean.
    await waitFor(() => {
      expect(saveButton()).toBeUndefined()
    })
  })
})
