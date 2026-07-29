// packages/lib/src/email/labels/index.ts

/**
 * Labels/folders — the provider-mirrored sync configuration of a mail channel.
 *
 * Server entrypoint for `@auxx/lib/email/labels`. Deliberately **not** re-exported
 * from `email/index.ts`: labels are their own subpath so a consumer that only
 * needs the label helpers does not pull the whole mail barrel (and its
 * `MessageService` / inbound pipeline) into its module graph.
 *
 * There is no `client.ts` — nothing client-side imports this module. The settings
 * UI consumes tRPC output types only, so a speculative client surface would be
 * dead code with a maintenance cost.
 *
 * **No permission logic lives behind this barrel** (module guide §6). The router
 * asserts `requireChannelManageAccess` per channel (or `inboxesView` +
 * `assertCanActOnThreads` for the thread lens) and then calls; the only guards in
 * here are identity ones — org scope and not-found.
 *
 * `requireLabel` from `label-queries.ts` is intentionally NOT exported: it throws
 * instead of returning a `Result` because it is a precondition helper for
 * `guard()`ed bodies inside this module. External callers want
 * {@link getLabelById}, which is the same lookup wrapped in a `Result`.
 *
 * `findLabelByProviderId` has **no callers today** (plan decision D4). It is the
 * natural lookup for reconciling a provider webhook payload against our rows and
 * was ported rather than dropped.
 */

export { discoverAndUpsertFolders } from './folder-discovery'
export {
  createLabel,
  deleteLabel,
  setLabelEnabled,
  setLabelVisibility,
  updateLabel,
} from './label-mutations'
export type { LabelProvider, ProviderLabel } from './label-provider.interface'
export { createLabelProvider } from './label-provider-factory'
export {
  findLabelByProviderId,
  getLabelById,
  listLabels,
  listThreadLabels,
} from './label-queries'
export {
  diffProviderLabels,
  syncAllIntegrationLabels,
  syncIntegrationLabels,
} from './label-sync'
export { addLabelToThread, removeLabelFromThread } from './thread-label-mutations'
export type {
  CreateLabelInput,
  DeleteLabelInput,
  DiscoveredFolder,
  LabelDiffCreate,
  LabelDiffUpdate,
  LabelEntity,
  LabelInsert,
  LabelIntegrationRef,
  ListLabelsFilters,
  ProviderLabelDiff,
  SyncAllResult,
  SyncIntegrationOutcome,
  SyncIntegrationParams,
  UpdateLabelChanges,
  UpdateLabelInput,
} from './types'
