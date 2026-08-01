// packages/lib/src/inboxes/types.ts

import type { RecordId } from '@auxx/types/resource'
import type { Lens } from '../permissions/visibility/lens'
import type { InboxDef } from '../resource-access/mail-sharing-defs'

/** Inbox status options */
export type InboxStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED'

/** Input for creating an inbox */
export interface CreateInboxInput {
  name: string
  description?: string
  color?: string
  status?: InboxStatus
  /**
   * Which of the two inbox definitions to create under (plan 40 §3.2).
   * Defaults to `'inbox'` — personal mailboxes are created ONLY by the personal
   * connect provisioning path (`provisionPersonalInbox`), which passes
   * `'personal_inbox'`. The generic `inbox.create` router path must never pass
   * it (40a §8.4: the def is not user-creatable).
   */
  entityDefinitionKey?: InboxDef
  /**
   * Org-wide visibility floor (defaults to `full` — everyone sees everything).
   *
   * Stored as the `role:org_member` `ResourceAccess` baseline row, NOT as
   * `inbox_default_lens` (plan 40 §6) — `full` writes no row at all, since the
   * absent baseline IS the org-shared default. Ignored for `personal_inbox`,
   * which has no org-wide floor by construction.
   */
  defaultLens?: Lens
  /**
   * Owner of a personal inbox (§11).
   *
   * There is no `isPersonal` sibling: personal-ness is `entityDefinitionKey ===
   * 'personal_inbox'`, and `inbox_is_personal` was deleted by plan 40 phase 4.
   */
  ownerUserId?: string
  settings?: Record<string, unknown>
}

/** Input for updating an inbox */
export interface UpdateInboxInput {
  name?: string
  description?: string
  color?: string
  status?: InboxStatus
  defaultLens?: Lens
  /**
   * Nulled by the admin claim action (§11.4), which is a cross-def MOVE
   * (`moveInboxDef`) — there is no marker field left to clear alongside it.
   */
  ownerUserId?: string | null
  settings?: Record<string, unknown>
}

/** Inbox with resolved field values */
export interface Inbox {
  /** Raw instance ID (for DB operations only) */
  id: string
  /**
   * Branded RecordId — use this for all service method calls.
   *
   * Always keyed by the SLUG of the definition the instance actually lives on
   * (`inbox:<id>` or `personal_inbox:<id>`), never by the def CUID: that is the
   * keyspace `ResourceAccess` mail rows use (`mail-sharing-defs.ts`), so a
   * CUID-keyed inbox RecordId is the shape of the 2026-07-29 grant bug.
   */
  recordId: RecordId
  /**
   * Which of the two inbox definitions this instance lives on (plan 40 §3.4).
   *
   * THE def discriminator for the merged `inboxes` org-cache list: mail
   * RecordIds and `ResourceAccess` rows for this inbox are keyed by this slug,
   * so `toRecordId(inbox.entityDefinitionKey, inbox.id)` is how a caller mints
   * a correct RecordId from a bare inbox id. Do not derive it from
   * {@link isPersonal} — the two disagree for the whole window between entity
   * migration 059 and data migration 060.
   */
  entityDefinitionKey: InboxDef
  name: string
  description: string | null
  color: string
  status: InboxStatus
  /**
   * Org-wide visibility floor: the lens every org member gets on this inbox
   * (mail-permissions §2.2). Explicit grants can only raise it.
   *
   * DERIVED FROM ROWS since plan 40 §6, not from `inbox_default_lens`: `none`
   * ⇐ `role:org_member @ none`, `metadata`/`subject` ⇐ `role:org_member @ view`
   * with the lens preserved, and `full` ⇐ NO baseline row (the `Area.inboxes`
   * fallback supplies it). A `personal_inbox` instance always reports `none` —
   * it has no org-wide floor at all, which is what `baselineAtCreate: true`
   * means.
   */
  defaultLens: Lens
  /**
   * Personal-account marker (§11) — automation and admin short-circuits treat
   * personal inboxes as restricted.
   *
   * DERIVED, not stored (plan 40 §3.4): true when the instance lives on the
   * `personal_inbox` definition OR still carries the legacy
   * `inbox_is_personal` FieldValue.
   *
   * **The marker half survives phase 4's field deletion on purpose.** Data
   * migrations run asynchronously at WORKER BOOT (`data-migrations-job.ts`), not
   * as a blocking pre-deploy step, so new code serves requests while 060/062 are
   * still queued. In that window an unmigrated org's personal mailboxes are
   * still on the shared def carrying the marker, and def-only would report them
   * `false` → no personal branch in `composeUserInstanceGrants` → the
   * `Area.inboxes` fallback hands every member `full` on someone's private
   * mailbox. Registry deletion does not hide the value either: the resource
   * registry merges DB `CustomField` rows and keeps unmatched ones
   * (`resource-registry-service.ts` — `[...unmatchedStaticFields,
   * ...enrichedDbFields]`), so the read keeps working until 062 drops the row,
   * after which this half is simply `undefined` and costs nothing.
   */
  isPersonal: boolean
  /** Owner of a personal inbox (§11). Null on shared org inboxes. */
  ownerUserId: string | null
  settings: Record<string, unknown>
  organizationId: string
  createdAt: Date
  updatedAt: Date
  createdById: string | null
}

/** Single inbox integration */
export interface InboxIntegration {
  id: string
  integrationId: string
  isDefault: boolean
  settings: Record<string, unknown>
  integration: {
    id: string
    /** `Integration.name` is nullable — callers fall back to email/provider. */
    name: string | null
    email: string | null
    provider: string
  }
}

/** Inbox with integrations */
export interface InboxWithIntegrations extends Inbox {
  integrations: InboxIntegration[]
}
