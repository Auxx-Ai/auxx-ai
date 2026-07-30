// apps/web/src/components/threads/hooks/use-inbox.ts

import type { ChannelLens } from '@auxx/lib/realtime/client'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { useMemo } from 'react'
import { type FieldInfo, useAllRecords } from '~/components/resources/hooks/use-all-records'
import type { RecordMeta } from '~/components/resources/store/record-store'
import type { api } from '~/trpc/react'
import { useMyInboxLenses } from './use-my-inbox-lenses'

/**
 * The two definitions a mailbox can live on (plan 40 §3/§3.4): `inbox` is the
 * org-shared one, `personal_inbox` a member's connected account. Both are
 * exempt from `assertNotInstanceAccessDef`'s READ arm (plan 40 §8.1), which is
 * what keeps the generic `record.listAll` path open for them.
 */
export const INBOX_DEF_KEYS = ['inbox', 'personal_inbox'] as const

/** Which of the two inbox definitions a record lives on. */
export type InboxDefKey = (typeof INBOX_DEF_KEYS)[number]

/**
 * Invalidate the inbox record lists — BOTH definitions.
 *
 * `utils.record.listAll.invalidate({ entityDefinitionId })` matches on the
 * query input, so a single `'inbox'` call leaves the `personal_inbox` list
 * stale: personal mailboxes would keep their pre-mutation name/colour/status
 * in the sidebar and every picker until the 30 s staleTime expired.
 */
export function invalidateInboxRecordLists(utils: ReturnType<typeof api.useUtils>): void {
  for (const entityDefinitionId of INBOX_DEF_KEYS) {
    utils.record.listAll.invalidate({ entityDefinitionId })
  }
}

/**
 * Inbox record type from useAllRecords.
 * Field keys use inbox_ prefix (e.g., inbox_name, inbox_color).
 */
export interface InboxRecord extends RecordMeta {
  recordId: RecordId
  fieldValues: {
    inbox_name?: string
    inbox_description?: string
    inbox_color?: string
    inbox_status?: 'ACTIVE' | 'ARCHIVED' | 'PAUSED'
    /**
     * Legacy marker, deleted from the registry by plan 40 phase 4 but still
     * present on records in an org whose data migrations (060/062) have not run
     * yet — they are enqueued at worker boot, not before the deploy. Read only
     * by the `isPersonal` OR below; see `InboxItem.isPersonal`.
     */
    inbox_is_personal?: boolean
    inbox_owner_user_id?: string
  }
}

/**
 * Simplified inbox type for UI components
 */
export interface InboxItem {
  id: string
  recordId: RecordId
  name: string
  description?: string | null
  color?: string | null
  status?: 'ACTIVE' | 'ARCHIVED' | 'PAUSED'
  /**
   * The org-wide floor. Drives the access badges on the inbox cards, the
   * detail page's info card, and the share popover's inherited-access footer.
   *
   * Sourced from `inbox.myLenses`' `floors` map (plan 40 §6), NOT from the
   * `inbox_default_lens` field value on the record: the floor is a
   * `role:org_member` `ResourceAccess` row now, and nothing has read that field
   * since phase 2 — rendering it would show the org the floor it had before its
   * last edit. `full` while the query is in flight, matching `myLens`.
   */
  defaultLens: 'none' | 'metadata' | 'identity' | 'read'
  /**
   * The viewer's effective lens on this inbox (mail-permissions §6.4).
   * Undefined while `inbox.myLenses` is loading; never `'none'` — such
   * inboxes still render (the record itself is org-visible), their threads
   * simply never load.
   */
  myLens?: ChannelLens
  /**
   * Which of the two inbox definitions this record lives on (plan 40 §3.4).
   * THE def discriminator — `toRecordId(entityDefinitionKey, id)` is how to
   * mint a correct RecordId for this inbox.
   */
  entityDefinitionKey: InboxDefKey
  /**
   * Personal-account inbox (§11) — one user's connected mailbox.
   *
   * DERIVED: `personal_inbox` def membership OR the legacy
   * `inbox_is_personal` FieldValue.
   *
   * **The marker half survives phase 4's field deletion** — mirroring
   * `InboxService.derivePersonal`, which carries the full rationale. Short
   * version: data migrations are enqueued at worker boot rather than gating the
   * deploy, so until 060 has run an org's personal mailboxes are still on the
   * shared def with only the marker to identify them, and reading the def alone
   * would render them as ordinary shared inboxes in the sidebar. After 062 the
   * value is simply absent and the OR short-circuits on the def.
   */
  isPersonal: boolean
  /** Owner of a personal inbox; null on shared org inboxes. */
  ownerUserId: string | null
}

/**
 * Build the canonical capability/access RecordId for an inbox.
 *
 * Record-layer inbox ids can carry the EntityDefinition UUID, while instance
 * capabilities are keyed by the stable `inbox` / `personal_inbox` slug. Always
 * use the definition discriminator retained on {@link InboxItem}.
 */
export function toInboxAccessRecordId(
  inbox: Pick<InboxItem, 'entityDefinitionKey' | 'id'>
): RecordId {
  return toRecordId(inbox.entityDefinitionKey, inbox.id)
}

/**
 * Result from useInboxes hook
 */
interface UseInboxesResult {
  /** All inboxes as simplified items */
  inboxes: InboxItem[]
  /** Raw records from store */
  records: InboxRecord[]
  /** Map for quick lookup by RecordId */
  inboxMap: Map<RecordId, InboxItem>
  /** Field definitions */
  fields: Record<string, FieldInfo>
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Refresh data */
  refresh: () => void
}

/**
 * `useAllRecords` surfaces SINGLE_SELECT field values as one-element arrays
 * (uniform UI format); unwrap so scalar-typed consumers compare correctly.
 */
function scalarValue<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Hook to fetch all inboxes using the entity system.
 *
 * Fetches BOTH inbox definitions and returns ONE merged list, mirroring the
 * server-side `inboxes` org cache (plan 40 §3.4): the 18 UI consumers read
 * `InboxItem.isPersonal` and need no def awareness. Sites that must exclude
 * personal mailboxes (routing pickers, chat-widget destinations) keep filtering
 * on `isPersonal`, as they do today.
 */
export function useInboxes(options: { enabled?: boolean } = {}): UseInboxesResult {
  const enabled = options.enabled ?? true
  const shared = useAllRecords<InboxRecord>({ entityDefinitionId: 'inbox', enabled })
  // The personal def only exists once entity migration 059 has run — it runs
  // for every org in one deploy-time pass, so the gap is a deploy race, not a
  // steady state. In that gap `record.listAll` rejects the key, and this arm's
  // error is deliberately NOT merged into `error` below: a not-yet-migrated org
  // degrades to shared-only (`records` = [], exactly the pre-plan-40 result)
  // instead of taking the mail sidebar down. Not gated on a client-side "does
  // the def exist" probe on purpose — a wrong probe would make personal
  // mailboxes silently absent, which is the failure mode this whole plan is
  // about; a failing query is at least loud.
  const personal = useAllRecords<InboxRecord>({
    entityDefinitionId: 'personal_inbox',
    enabled,
  })
  const { lenses, floors } = useMyInboxLenses(enabled)

  const records = useMemo(
    () => [...shared.records, ...personal.records],
    [shared.records, personal.records]
  )

  // Transform records to simplified inbox items
  const { inboxes, inboxMap } = useMemo(() => {
    const build = (list: InboxRecord[], defKey: InboxDefKey): InboxItem[] =>
      list.map((record) => ({
        id: record.id,
        recordId: record.recordId,
        entityDefinitionKey: defKey,
        name: record.fieldValues?.inbox_name ?? record.displayName ?? 'Untitled',
        description: record.fieldValues?.inbox_description ?? null,
        color: record.fieldValues?.inbox_color ?? null,
        status: scalarValue(record.fieldValues?.inbox_status),
        // Row-derived (see `InboxItem.defaultLens`). `inbox_default_lens` is
        // gone entirely now — registry, CustomField rows and all.
        defaultLens: floors[record.id] ?? (defKey === 'personal_inbox' ? 'none' : 'read'),
        myLens: lenses[record.id],
        // Def membership OR the legacy marker — see `InboxItem.isPersonal`.
        isPersonal: defKey === 'personal_inbox' || (record.fieldValues?.inbox_is_personal ?? false),
        ownerUserId: record.fieldValues?.inbox_owner_user_id ?? null,
      }))

    const items = [...build(shared.records, 'inbox'), ...build(personal.records, 'personal_inbox')]

    // Key map by recordId for direct lookup (thread.inboxId is now RecordId)
    const map = new Map<RecordId, InboxItem>(items.map((item) => [item.recordId, item]))

    return { inboxes: items, inboxMap: map }
  }, [shared.records, personal.records, lenses, floors])

  const refresh = useMemo(
    () => () => {
      shared.refresh()
      personal.refresh()
    },
    [shared.refresh, personal.refresh]
  )

  return {
    inboxes,
    records,
    inboxMap,
    // Shared def's field map only — the two defs share systemAttribute KEYS
    // (`inbox_name`, …) but have their own CustomField UUIDs, so merging them
    // would collide on every key and hand out the wrong id for saves.
    fields: shared.fields,
    isLoading: enabled && (shared.isLoading || personal.isLoading),
    error: shared.error,
    refresh,
  }
}

/**
 * Result of useInbox hook
 */
interface UseInboxResult {
  inbox: InboxItem | undefined
  isLoading: boolean
}

/**
 * Hook to get a single inbox by RecordId.
 * Since thread.inboxId is now RecordId, lookup is direct.
 */
export function useInbox(
  inboxId: RecordId | null | undefined,
  options: { enabled?: boolean } = {}
): UseInboxResult {
  const enabled = (options.enabled ?? true) && !!inboxId
  const { inboxMap, isLoading } = useInboxes({ enabled })

  const inbox = useMemo(() => {
    if (!inboxId) return undefined
    return inboxMap.get(inboxId) // Direct lookup by recordId
  }, [inboxId, inboxMap])

  return { inbox, isLoading }
}

/**
 * Resolve an inbox from a route or API instance id while preserving the
 * definition-aware RecordId returned by the record layer.
 */
export function useInboxByInstanceId(
  inboxId: string | null | undefined,
  options: { enabled?: boolean } = {}
): UseInboxResult {
  const enabled = (options.enabled ?? true) && !!inboxId
  const { inboxes, isLoading } = useInboxes({ enabled })

  const inbox = useMemo(() => {
    if (!inboxId) return undefined
    return inboxes.find((item) => item.id === inboxId)
  }, [inboxId, inboxes])

  return { inbox, isLoading }
}
