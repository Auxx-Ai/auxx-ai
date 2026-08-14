// packages/lib/src/data-migrations/registry.ts

import { ALL_ENTITY_MIGRATIONS } from '../seed/entity-migrations'
import { migration024VerifyCredentialV2Backfill } from './migrations/024-verify-credential-v2-backfill'
import { migration025ReseedPlatformProviders } from './migrations/025-reseed-platform-providers'
import { migration026NormalizeChannelCredentials } from './migrations/026-normalize-channel-credentials'
import { migration027BackfillCredentialDefinitionFk } from './migrations/027-backfill-credential-definition-fk'
import { migration028DataConnectorStreamSyncModeWebhook } from './migrations/028-data-connector-stream-syncmode-webhook'
import { migration029SeedRecordIdentityIndex } from './migrations/029-seed-record-identity-index'
import { migration030RetireShopifyProductLinkId } from './migrations/030-retire-shopify-product-link-id'
import { migration031BackfillThreadInboxId } from './migrations/031-backfill-thread-inbox-id'
import { migration032BackfillThreadParticipants } from './migrations/032-backfill-thread-participants'
import { migration033InboxVisibilityToDefaultLens } from './migrations/033-inbox-visibility-to-default-lens'
import { migration034RetireInboxVisibility } from './migrations/034-retire-inbox-visibility'
import { migration035UserSettingRekeyBackfill } from './migrations/035-usersetting-rekey-backfill'
import { migration036DocumentsTaxRatesScope } from './migrations/036-documents-taxrates-scope'
import { migration037BackfillMessageMachineMailTier } from './migrations/037-backfill-message-machine-mail-tier'
import { migration038ReseedPlatformProvidersScopeTrim } from './migrations/038-reseed-platform-providers-scope-trim'
import { migration039GoogleAppClientPendingApproval } from './migrations/039-google-app-client-pending-approval'
import { migration040BackfillDashboardInstanceAccess } from './migrations/040-backfill-dashboard-instance-access'
import { migration049SeedPermissionProfiles } from './migrations/049-seed-permission-profiles'
import { migration050AgentVersionPermissionPolicy } from './migrations/050-agent-version-permission-policy'
import { migration051GoogleAppScopeAlignment } from './migrations/051-google-app-scope-alignment'
import { migration052MemberBaselineBackfill } from './migrations/052-member-baseline-backfill'
import { migration053SeedAgentPresetProfiles } from './migrations/053-seed-agent-preset-profiles'
import { migration054AgentPolicyVocabulary } from './migrations/054-agent-policy-vocabulary'
import { migration055AgentPolicyResourceAreaFallthrough } from './migrations/055-agent-policy-resource-area-fallthrough'
import { migration056SignaturesSnippetsInstanceAccess } from './migrations/056-signatures-snippets-instance-access'
import { migration058ReopenPersonalOnboarding } from './migrations/058-reopen-personal-onboarding'
import { migration060PersonalInboxMove } from './migrations/060-personal-inbox-move'
import { migration061InboxesMemberBaselineBackfill } from './migrations/061-inboxes-member-baseline-backfill'
import { migration063RetireMailPermissionsFeatureKey } from './migrations/063-retire-mail-permissions-feature-key'
import { migration064SequencesLimit } from './migrations/064-sequences-limit'
import { migration065DashboardsAllPlans } from './migrations/065-dashboards-all-plans'
import { migration066DemoMonthlyAiCredits } from './migrations/066-demo-monthly-ai-credits'
import { migration067ClearDeadLearnedStamps } from './migrations/067-clear-dead-learned-stamps'
import { migration068WidenEntitySearchText } from './migrations/068-widen-entity-search-text'
import { migration069BackfillThreadSearchText } from './migrations/069-backfill-thread-search-text'
import { migration070BackfillArticleSearchText } from './migrations/070-backfill-article-search-text'
import { migration071BackfillOutlookPlainText } from './migrations/071-backfill-outlook-plain-text'
import { migration072MailFiltersLimit } from './migrations/072-mail-filters-limit'
import { migration073BackfillBulkMailFields } from './migrations/073-backfill-bulk-mail-fields'
import { migration076MailCategoryRework } from './migrations/076-mail-category-rework'
import { migration077BackfillUnsentThreadDates } from './migrations/077-backfill-unsent-thread-dates'
import { migration078TicketTypeUpdatable } from './migrations/078-ticket-type-updatable'
import { migration079EnrichmentFieldsBackendOwned } from './migrations/079-enrichment-fields-backend-owned'
import { migration080OutlookWebhookCutover } from './migrations/080-outlook-webhook-cutover'
import { migration081BackfillInteractionFields } from './migrations/081-backfill-interaction-fields'
import { migration082InteractionFieldsParticipantResolution } from './migrations/082-interaction-fields-participant-resolution'
import { migration083FindManyPluralToIdRefs } from './migrations/083-find-many-plural-to-id-refs'
import { migration084PrimaryEmailUnique } from './migrations/084-primary-email-unique'
import { assertUniqueMigrationIds } from './plan'
import type { DataMigrationDef } from './types'
import { wrapEntityMigration } from './wrap-entity-migration'

/**
 * Build the registry of all available data migrations, sorted by id.
 *
 * Today this is exactly the 23 entity migrations, adapted via {@link wrapEntityMigration}.
 * Pure-data migrations are authored as `migrations/NNN-slug.ts` exporting a
 * `DataMigrationDef` and appended to the spread below — they share the same global
 * id sequence as the entity migrations (a `025` backfill can depend on a field a
 * `024` migration creates; fail-stop enforces the order).
 */
function buildRegistry(): DataMigrationDef[] {
  const all: DataMigrationDef[] = [
    ...ALL_ENTITY_MIGRATIONS.map(wrapEntityMigration),
    // Pure-data migrations go here, e.g. migration024BackfillFoo
    migration024VerifyCredentialV2Backfill,
    migration025ReseedPlatformProviders,
    migration026NormalizeChannelCredentials,
    migration027BackfillCredentialDefinitionFk,
    migration028DataConnectorStreamSyncModeWebhook,
    migration029SeedRecordIdentityIndex,
    migration030RetireShopifyProductLinkId,
    migration031BackfillThreadInboxId,
    migration032BackfillThreadParticipants,
    migration033InboxVisibilityToDefaultLens,
    migration034RetireInboxVisibility,
    migration035UserSettingRekeyBackfill,
    migration036DocumentsTaxRatesScope,
    migration037BackfillMessageMachineMailTier,
    migration038ReseedPlatformProvidersScopeTrim,
    migration039GoogleAppClientPendingApproval,
    migration040BackfillDashboardInstanceAccess,
    migration049SeedPermissionProfiles,
    migration050AgentVersionPermissionPolicy,
    migration051GoogleAppScopeAlignment,
    migration052MemberBaselineBackfill,
    migration053SeedAgentPresetProfiles,
    migration054AgentPolicyVocabulary,
    migration055AgentPolicyResourceAreaFallthrough,
    migration056SignaturesSnippetsInstanceAccess,
    migration058ReopenPersonalOnboarding,
    // 059 is an ENTITY migration (`personal_inbox` def + fields) and arrives via
    // ALL_ENTITY_MIGRATIONS above — it needs no entry here, but it owns 059 in
    // the shared id sequence and sorts before 060, which depends on it.
    migration060PersonalInboxMove,
    migration061InboxesMemberBaselineBackfill,
    // 062 is an ENTITY migration (drops the retired inbox lens/personal fields)
    // and arrives via ALL_ENTITY_MIGRATIONS above; it owns 062 in the shared id
    // sequence.
    migration063RetireMailPermissionsFeatureKey,
    migration064SequencesLimit,
    migration065DashboardsAllPlans,
    migration066DemoMonthlyAiCredits,
    migration067ClearDeadLearnedStamps,
    migration068WidenEntitySearchText,
    migration069BackfillThreadSearchText,
    migration070BackfillArticleSearchText,
    migration071BackfillOutlookPlainText,
    migration072MailFiltersLimit,
    migration073BackfillBulkMailFields,
    // 074 (`tag_ai_classify`) and 075 (`tag_template_key`) are ENTITY migrations
    // and arrive via ALL_ENTITY_MIGRATIONS above; they own those ids in the
    // shared sequence and both sort before 076, which depends on the fields they
    // materialize.
    migration076MailCategoryRework,
    migration077BackfillUnsentThreadDates,
    migration078TicketTypeUpdatable,
    migration079EnrichmentFieldsBackendOwned,
    migration080OutlookWebhookCutover,
    migration081BackfillInteractionFields,
    migration082InteractionFieldsParticipantResolution,
    migration083FindManyPluralToIdRefs,
    migration084PrimaryEmailUnique,
  ]

  all.sort((a, b) => a.id.localeCompare(b.id))

  // Fail loud at module load if two migrations claim the same id.
  assertUniqueMigrationIds(all)

  return all
}

export const ALL_DATA_MIGRATIONS: DataMigrationDef[] = buildRegistry()
