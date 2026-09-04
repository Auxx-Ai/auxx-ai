// packages/lib/src/audit-log/audit-actions.ts
// Client-safe single source of truth for audit action strings. Actions stay plain
// `text` in the DB (no migration for new actions); this map exists purely to give the
// ~80 call sites autocomplete and a typo-catching union without forbidding ad-hoc
// strings. Naming convention: `noun.verb_past` (e.g. `subscription.canceled`).
// No server imports — safe for client components via @auxx/lib/audit-log/client.

export const AUDIT_ACTIONS = {
  // ── auth ────────────────────────────────────────────────────────────────
  login: 'auth.login',
  signin: 'auth.signin',
  signinFailed: 'auth.signin_failed',
  passwordChanged: 'password.changed',
  passwordResetRequested: 'password.reset_requested',
  passwordResetCompleted: 'password.reset_completed',
  oauthLinked: 'oauth.linked',
  emailChangeRequested: 'email.change_requested',
  emailVerified: 'email.verified',

  // ── security ────────────────────────────────────────────────────────────
  apiKeyCreated: 'apiKey.created',
  apiKeyRevoked: 'apiKey.revoked',
  permissionGranted: 'permission.granted',
  permissionRevoked: 'permission.revoked',
  permissionSet: 'permission.set',
  // Access-request decisions. An APPROVED request deliberately records
  // `permission.granted` — the same action the share popover writes — because "how
  // did this person get access to X" must be one filter on `targetId`, not two. Only
  // the outcomes that write no grant get their own actions.
  accessRequestDenied: 'accessRequest.denied',
  accessRequestSuperseded: 'accessRequest.superseded',
  permissionProfileCreated: 'permission.profile.created',
  permissionProfileUpdated: 'permission.profile.updated',
  sessionsInvalidated: 'sessions.invalidated',
  twoFactorEnabled: '2fa.enabled',
  twoFactorDisabled: '2fa.disabled',
  passkeyAdded: 'passkey.added',
  passkeyRemoved: 'passkey.removed',
  connectionClientSecretRevealed: 'connection.client_secret_revealed',
  // super-admin actions on a user (internal)
  userDeleted: 'user.deleted',
  userEmailVerifiedByAdmin: 'user.email_verified_by_admin',
  userPasswordResetForced: 'user.password_reset_forced',
  userSessionsRevoked: 'user.sessions_revoked',
  userTwoFactorDisabledByAdmin: 'user.2fa_disabled_by_admin',
  userBanned: 'user.banned',
  userUnbanned: 'user.unbanned',
  userSuperadminGranted: 'user.superadmin_granted',
  userSuperadminRevoked: 'user.superadmin_revoked',

  // ── members ─────────────────────────────────────────────────────────────
  memberInvited: 'member.invited',
  memberRemoved: 'member.removed',
  // NOTE: no `member.role_changed`. Rank is no longer authorable on its own
  // (plan 21 §2.0.1) — the only path that writes it is profile assignment, which
  // records `member.profile_assigned` with the role transition in
  // previous/newState. Filter on that action to find rank changes.
  memberProfileAssigned: 'member.profile_assigned',
  memberSeatTypeChanged: 'member.seat_type_changed',
  memberLeft: 'member.left',
  invitationAccepted: 'invitation.accepted',
  invitationCanceled: 'invitation.canceled',
  invitationResent: 'invitation.resent',

  // ── settings ────────────────────────────────────────────────────────────
  settingChanged: 'setting.changed',
  settingBatchChanged: 'setting.batch_changed',
  organizationCreated: 'org.created',
  organizationUpdated: 'organization.updated',
  organizationSwitched: 'organization.switched',
  organizationDeleteRequested: 'org.delete_requested',
  // super-admin org actions (internal)
  organizationDeleted: 'org.deleted',
  organizationSeeded: 'org.seeded',
  organizationCacheFlushed: 'org.cache_flushed',
  organizationMigrationsRun: 'org.migrations_run',
  // schema reshaping
  entityDefCreated: 'entityDef.created',
  entityDefUpdated: 'entityDef.updated',
  entityDefArchived: 'entityDef.archived',
  entityDefRestored: 'entityDef.restored',
  entityDefDeleted: 'entityDef.deleted',
  customFieldCreated: 'customField.created',
  customFieldUpdated: 'customField.updated',
  customFieldDeleted: 'customField.deleted',
  // AI providers/credentials (security-relevant, kept in settings category)
  aiCredentialAdded: 'aiCredential.added',
  aiCredentialRemoved: 'aiCredential.removed',
  aiProviderConfigured: 'aiProvider.configured',
  aiProviderSetDefault: 'aiProvider.set_default',
  aiModelToggled: 'aiModel.toggled',

  // ── billing ─────────────────────────────────────────────────────────────
  subscriptionActivated: 'subscription.activated',
  subscriptionUpdated: 'subscription.updated',
  subscriptionCanceled: 'subscription.canceled',
  subscriptionCancelRequested: 'subscription.cancel_requested',
  subscriptionScheduledChangeCanceled: 'subscription.scheduled_change_canceled',
  invoicePaid: 'invoice.paid',
  paymentFailed: 'payment.failed',
  usageCharged: 'billing.usage_charged',
  paymentMethodAdded: 'paymentMethod.added',
  paymentMethodRemoved: 'paymentMethod.removed',
  billingAddressUpdated: 'billingAddress.updated',
  // super-admin billing actions on an org (internal)
  organizationPlanChanged: 'org.plan_changed',
  organizationAccessDisabled: 'org.access_disabled',
  organizationAccessEnabled: 'org.access_enabled',
  subscriptionCreatedByAdmin: 'subscription.created_by_admin',
  trialEnded: 'trial.ended',
  trialExtended: 'trial.extended',
  trialConverted: 'trial.converted',

  // ── integrations ────────────────────────────────────────────────────────
  integrationConnected: 'integration.connected',
  integrationConnectionFailed: 'integration.connection_failed',
  integrationShopifyConnected: 'integration.shopify_connected',
  integrationDisconnected: 'integration.disconnected',
  channelConnected: 'channel.connected',
  inboxCreated: 'inbox.created',
  inboxDeleted: 'inbox.deleted',
  inboxAccessChanged: 'inbox.access_changed',
  inboxIntegrationAdded: 'inbox.integration_added',
  inboxIntegrationRemoved: 'inbox.integration_removed',

  // ── apps ────────────────────────────────────────────────────────────────
  appInstalled: 'app.installed',
  appUninstalled: 'app.uninstalled',
  appSettingsChanged: 'app.settings_changed',
  // Removing the columns an UNINSTALLED app left behind (plans/money/tasks/44 D-5).
  // Audited because it is the one sanctioned path that hard-deletes protected,
  // app-owned fields AND their values outside a connector teardown.
  appLeftoverFieldsRemoved: 'app.leftover_fields_removed',
  // platform app-catalog actions (internal)
  appPublished: 'app.published',
  appUnpublished: 'app.unpublished',
  appReviewApproved: 'app.review_approved',
  appReviewRejected: 'app.review_rejected',
  appReviewDeprecated: 'app.review_deprecated',
  workflowTemplateCreated: 'workflowTemplate.created',
  workflowTemplateUpdated: 'workflowTemplate.updated',
  workflowTemplateDeleted: 'workflowTemplate.deleted',
  // workflows
  workflowCreated: 'workflow.created',
  workflowPublished: 'workflow.published',
  workflowDeleted: 'workflow.deleted',
  workflowShareTokenGenerated: 'workflow.share_token_generated',
  workflowShareTokenRevoked: 'workflow.share_token_revoked',
  // groups
  groupCreated: 'group.created',
  groupDeleted: 'group.deleted',
  groupMemberAdded: 'group.member_added',
  groupMemberRemoved: 'group.member_removed',
  groupPermissionGranted: 'group.permission_granted',
  groupPermissionRevoked: 'group.permission_revoked',

  // ── data_export ─────────────────────────────────────────────────────────
  dataExported: 'data.exported',
  auditExported: 'audit.exported',
  auditExportedAll: 'audit.exported_all',
  recordsExported: 'records.exported',
} as const

/**
 * Known audit action strings. The `(string & {})` arm keeps ad-hoc actions legal
 * (DB column is plain text) while still surfacing autocomplete for the known ones.
 */
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {})
