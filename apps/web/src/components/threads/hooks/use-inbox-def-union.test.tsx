// apps/web/src/components/threads/hooks/use-inbox-def-union.test.tsx

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 phase 1, seam 3 — `useInboxes` across BOTH inbox definitions.
 *
 * This hook is the FE's ONLY inbox list: the mail sidebar, the settings grid,
 * the routing pickers, the channel cards, the member-accounts section and the
 * mail-box context all read `InboxItem` off it. Eighteen consumers branch on
 * `isPersonal`, so getting the merge and the derivation right here is what lets
 * every one of them stay untouched.
 *
 * Both directions are asserted: a personal mailbox must APPEAR in the merged
 * list (sidebar, settings) and must still be EXCLUDED wherever a consumer
 * filters on `isPersonal` (routing targets, chat-widget destinations) — the
 * latter is the half that regresses silently.
 */

const { useAllRecords, useMyInboxLenses } = vi.hoisted(() => ({
  useAllRecords: vi.fn(),
  useMyInboxLenses: vi.fn(),
}))

vi.mock('~/components/resources/hooks/use-all-records', () => ({ useAllRecords }))
vi.mock('./use-my-inbox-lenses', () => ({ useMyInboxLenses }))
// The dynamic-options registry pulls the tRPC react client in for its other
// entries; only the inbox entry is under test here.
vi.mock('~/trpc/react', () => ({
  api: {
    user: { teamMembers: { useQuery: () => ({ data: [], isLoading: false }) } },
    channel: { list: { useQuery: () => ({ data: undefined, isLoading: false }) } },
    tag: { getAll: { useQuery: () => ({ data: [], isLoading: false }) } },
  },
}))

const { INBOX_DEF_KEYS, invalidateInboxRecordLists, useInboxes } = await import('./use-inbox')
const { DYNAMIC_OPTIONS_REGISTRY } = await import(
  '~/components/fields/registries/dynamic-options-registry'
)

const SHARED_ID = 'ibx_shared'
const PERSONAL_ID = 'ibx_personal'
const OWNER = 'usr_owner'

type Rec = {
  id: string
  recordId: string
  displayName?: string
  fieldValues: Record<string, unknown>
}

const rec = (id: string, defKey: string, fieldValues: Record<string, unknown> = {}): Rec => ({
  id,
  recordId: `${defKey}:${id}`,
  displayName: id,
  fieldValues,
})

const arm = (records: Rec[], over: Record<string, unknown> = {}) => ({
  records,
  fields: {},
  isLoading: false,
  error: null,
  refresh: vi.fn(),
  entityDefinitionId: null,
  appendRecord: vi.fn(),
  removeRecord: vi.fn(),
  ...over,
})

/** Route each `useAllRecords` call to the arm for the def it asked for. */
function mockArms(arms: Record<string, ReturnType<typeof arm>>) {
  useAllRecords.mockImplementation((opts: { entityDefinitionId?: string }) => {
    const found = arms[opts.entityDefinitionId ?? '']
    if (!found) throw new Error(`unexpected def: ${opts.entityDefinitionId}`)
    return found
  })
}

beforeEach(() => {
  useAllRecords.mockReset()
  useMyInboxLenses.mockReset()
  // `floors` is the row-derived org-wide floor map (plan 40 §6) — empty means
  // no inbox carries a `role:org_member` baseline row, i.e. every shared inbox
  // sits at the org-shared `full` default.
  useMyInboxLenses.mockReturnValue({ lenses: {}, floors: {} })
})

describe('useInboxes — fetches and merges BOTH inbox definitions', () => {
  it('queries `inbox` AND `personal_inbox`', () => {
    mockArms({ inbox: arm([]), personal_inbox: arm([]) })
    renderHook(() => useInboxes())
    expect(useAllRecords.mock.calls.map((c) => c[0].entityDefinitionId)).toEqual([
      'inbox',
      'personal_inbox',
    ])
  })

  it('returns one merged list carrying the def discriminator', () => {
    mockArms({
      inbox: arm([rec(SHARED_ID, 'inbox', { inbox_name: 'Support' })]),
      personal_inbox: arm([
        rec(PERSONAL_ID, 'personal_inbox', {
          inbox_name: 'me@example.com',
          inbox_owner_user_id: OWNER,
        }),
      ]),
    })

    const { result } = renderHook(() => useInboxes())

    expect(result.current.inboxes.map((i) => [i.id, i.entityDefinitionKey])).toEqual([
      [SHARED_ID, 'inbox'],
      [PERSONAL_ID, 'personal_inbox'],
    ])
    expect(result.current.records).toHaveLength(2)
    // `inboxMap` is keyed by RecordId — `thread.inboxId` is a RecordId, so a
    // personal thread's inbox only resolves if the personal arm is in the map.
    expect(result.current.inboxMap.get(`personal_inbox:${PERSONAL_ID}` as never)?.name).toBe(
      'me@example.com'
    )
  })
})

describe('useInboxes — isPersonal is derived, both eras', () => {
  it('a `personal_inbox` record is personal with NO marker field', () => {
    mockArms({
      inbox: arm([]),
      personal_inbox: arm([rec(PERSONAL_ID, 'personal_inbox', { inbox_owner_user_id: OWNER })]),
    })
    const { result } = renderHook(() => useInboxes())
    expect(result.current.inboxes[0]).toMatchObject({ isPersonal: true, ownerUserId: OWNER })
  })

  it('an `inbox` record carrying the legacy marker is STILL personal (pre-060 inertness)', () => {
    // Today's one personal mailbox lives on the shared def. Dropping this half
    // would publish it to the whole org the moment migration 059 lands.
    mockArms({
      inbox: arm([
        rec(PERSONAL_ID, 'inbox', { inbox_is_personal: true, inbox_owner_user_id: OWNER }),
      ]),
      personal_inbox: arm([]),
    })
    const { result } = renderHook(() => useInboxes())
    expect(result.current.inboxes[0]).toMatchObject({
      isPersonal: true,
      entityDefinitionKey: 'inbox',
    })
  })

  it('an ordinary shared inbox is not personal — the ABSENCE half consumers filter on', () => {
    mockArms({
      inbox: arm([rec(SHARED_ID, 'inbox', { inbox_default_lens: ['full'] })]),
      personal_inbox: arm([rec(PERSONAL_ID, 'personal_inbox')]),
    })
    const { result } = renderHook(() => useInboxes())

    // `inbox-picker.tsx` / `inbox-destination-field.tsx` filter exactly like this.
    const routingTargets = result.current.inboxes.filter((i) => !i.isPersonal)
    expect(routingTargets.map((i) => i.id)).toEqual([SHARED_ID])
    // No baseline row ⇒ the org-shared default.
    expect(routingTargets[0]?.defaultLens).toBe('full')
  })
})

describe('useInboxes — `defaultLens` is the ROW-derived floor (plan 40 §6)', () => {
  it('takes the floor from `myLenses.floors`, NOT from `inbox_default_lens`', () => {
    // The field is still on the record and still writable, but nothing has read
    // it since phase 2 moved the floor onto `role:org_member` ResourceAccess
    // rows. Rendering it would show the org the floor it had before its last
    // edit — the access badge, the detail card and the share popover's
    // inherited-access footer all read this value.
    useMyInboxLenses.mockReturnValue({ lenses: {}, floors: { [SHARED_ID]: 'subject' } })
    mockArms({
      inbox: arm([rec(SHARED_ID, 'inbox', { inbox_default_lens: ['full'] })]),
      personal_inbox: arm([]),
    })
    const { result } = renderHook(() => useInboxes())
    expect(result.current.inboxes[0]?.defaultLens).toBe('subject')
  })

  it('defaults a personal mailbox to `none` — it has no org-wide floor at all', () => {
    useMyInboxLenses.mockReturnValue({ lenses: {}, floors: {} })
    mockArms({
      inbox: arm([]),
      personal_inbox: arm([rec(PERSONAL_ID, 'personal_inbox')]),
    })
    const { result } = renderHook(() => useInboxes())
    expect(result.current.inboxes[0]?.defaultLens).toBe('none')
  })
})

describe('useInboxes — the personal arm never takes the sidebar down', () => {
  it('does not surface the personal arm’s error (org mid-migration 059)', () => {
    mockArms({
      inbox: arm([rec(SHARED_ID, 'inbox')]),
      personal_inbox: arm([], { error: new Error('Entity not found for key: personal_inbox') }),
    })
    const { result } = renderHook(() => useInboxes())
    expect(result.current.error).toBeNull()
    expect(result.current.inboxes.map((i) => i.id)).toEqual([SHARED_ID])
  })

  it('does surface the shared arm’s error', () => {
    const boom = new Error('boom')
    mockArms({ inbox: arm([], { error: boom }), personal_inbox: arm([]) })
    const { result } = renderHook(() => useInboxes())
    expect(result.current.error).toBe(boom)
  })

  it('refresh() reconciles both arms', () => {
    const sharedArm = arm([])
    const personalArm = arm([])
    mockArms({ inbox: sharedArm, personal_inbox: personalArm })
    const { result } = renderHook(() => useInboxes())
    result.current.refresh()
    expect(sharedArm.refresh).toHaveBeenCalledTimes(1)
    expect(personalArm.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('the `inboxes` dynamic-options entry unions both defs', () => {
  it('offers personal mailboxes too, keyed by bare instance id', () => {
    // Backs the thread `inbox` field's picker. A one-def list renders a thread
    // in a personal mailbox with an unresolvable id in its inbox column.
    mockArms({
      inbox: arm([rec(SHARED_ID, 'inbox', { inbox_name: 'Support' })]),
      personal_inbox: arm([rec(PERSONAL_ID, 'personal_inbox', { inbox_name: 'me@example.com' })]),
    })

    const { result } = renderHook(
      () => DYNAMIC_OPTIONS_REGISTRY.inboxes?.useOptions(true) ?? { data: [], isLoading: false }
    )

    expect(useAllRecords.mock.calls.map((c) => c[0].entityDefinitionId)).toEqual([
      'inbox',
      'personal_inbox',
    ])
    // The option VALUE carries no def prefix — the write path decides the def.
    expect(result.current.data).toEqual([
      { value: SHARED_ID, label: 'Support' },
      { value: PERSONAL_ID, label: 'me@example.com' },
    ])
  })
})

describe('invalidateInboxRecordLists', () => {
  it('invalidates the record list of BOTH defs', () => {
    // `invalidate({ entityDefinitionId })` matches on the query input, so one
    // `'inbox'` call leaves personal mailboxes showing stale names/colours in
    // the sidebar and every picker until staleTime expires.
    const invalidate = vi.fn()
    invalidateInboxRecordLists({ record: { listAll: { invalidate } } } as never)
    expect(invalidate.mock.calls.flat()).toEqual([
      { entityDefinitionId: 'inbox' },
      { entityDefinitionId: 'personal_inbox' },
    ])
    expect(INBOX_DEF_KEYS).toEqual(['inbox', 'personal_inbox'])
  })
})
