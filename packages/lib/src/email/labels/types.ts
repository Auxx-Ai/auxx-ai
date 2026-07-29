// packages/lib/src/email/labels/types.ts

import type { Label } from '@auxx/database'
import type { LabelType } from '@auxx/database/types'
import type { ChannelManageScope } from '../../channels/manage-access'

/**
 * DB row shape for a label/folder. Aliased here rather than re-derived at every
 * call site so the query/mutation signatures read as domain types and a schema
 * change lands in one place.
 *
 * NOTE: `integrationType` holds `Integration.provider` (`'google'`, `'outlook'`,
 * `'imap'`, …), NOT a "type of integration". The name is historical; the whole
 * module speaks it, so it is stated once here instead of in nine comments.
 */
export type LabelEntity = typeof Label.$inferSelect

/** Insert shape for the `Label` table, used by the sync diff's batched insert. */
export type LabelInsert = typeof Label.$inferInsert

/**
 * Provider + DB coordinates every label operation needs. The pair is required
 * (not derivable from the label row alone) because the provider client is built
 * per integration, and the caller has already authorized on `integrationId`.
 */
export interface LabelIntegrationRef {
  /** `Integration.provider` — see the note on {@link LabelEntity}. */
  integrationType: string
  integrationId: string
}

/**
 * Filters for {@link import('./label-queries').listLabels}.
 *
 * `scope` is the caller's pre-computed manage-authority allowlist and is applied
 * as SQL, never as a post-read `.filter()` — a post-filter leaks row counts even
 * when it hides content (module guide §6).
 */
export interface ListLabelsFilters {
  integrationType?: string
  integrationId?: string
  scope?: ChannelManageScope
}

/**
 * Create input. There is deliberately **no `userId`**: the `Label` table has no
 * such column and the old `LabelRepo.create` silently discarded the argument.
 */
export interface CreateLabelInput extends LabelIntegrationRef {
  name: string
  backgroundColor?: string
  textColor?: string
  description?: string
}

/** The mutable subset of a label. Absent keys are left untouched. */
export interface UpdateLabelChanges {
  name?: string
  backgroundColor?: string
  textColor?: string
  description?: string
  isVisible?: boolean
}

/** Update input — `labelId` is the `Label.id` PK, not the provider's label id. */
export interface UpdateLabelInput extends LabelIntegrationRef {
  labelId: string
  changes: UpdateLabelChanges
}

/** Delete input — `labelId` is the `Label.id` PK, not the provider's label id. */
export interface DeleteLabelInput extends LabelIntegrationRef {
  labelId: string
}

/** Coordinates for a thread↔label link write. */
export interface ThreadLabelParams extends LabelIntegrationRef {
  labelId: string
  threadId: string
}

/** Which integration to reconcile against its provider. */
export interface SyncIntegrationParams extends LabelIntegrationRef {}

/**
 * A row to insert, as produced by the pure diff. Org/integration columns are
 * added by the caller that owns them, so the diff stays `db`-free and testable.
 */
export interface LabelDiffCreate {
  labelId: string
  name: string
  type: LabelType
  backgroundColor: string | null
  textColor: string | null
  isVisible: boolean
}

/** A row to update, keyed by `Label.id`. Only provider-owned columns are set. */
export interface LabelDiffUpdate {
  id: string
  name: string
  backgroundColor: string | null
  textColor: string | null
  isVisible: boolean
}

/** Output of the pure provider↔DB comparison. `toDelete` holds `Label.id`s. */
export interface ProviderLabelDiff {
  toCreate: LabelDiffCreate[]
  toUpdate: LabelDiffUpdate[]
  toDelete: string[]
}

/**
 * Per-integration outcome of a fan-out sync. Discriminated rather than a plain
 * array so ONE expired token (a `ReauthenticationRequiredError` from that
 * integration's provider) cannot blank every other integration's labels — the
 * behavior of the old `Promise.all` fan-out.
 *
 * `error` is the message string, not an `Error`: this crosses the tRPC boundary
 * and an `Error` instance would not survive serialization intact.
 */
export type SyncIntegrationOutcome =
  | { integrationId: string; provider: string; ok: true; labels: LabelEntity[] }
  | { integrationId: string; provider: string; ok: false; error: string }

/** Result of {@link import('./label-sync').syncAllIntegrationLabels}. */
export type SyncAllResult = SyncIntegrationOutcome[]

/**
 * A folder as reported by a provider's `discoverLabels()`. Lives here (not in
 * the discovery module) because the polling providers produce it and the
 * discovery writer consumes it.
 */
export interface DiscoveredFolder {
  externalId: string
  name: string
  isSentBox: boolean
  parentExternalId: string | null
}
