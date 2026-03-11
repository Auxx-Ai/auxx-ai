// packages/database/src/db/relations/build.ts
// Relations for developer portal (build) domain

import { relations } from 'drizzle-orm/relations'
import {
  App,
  AppBundle,
  AppDeployment,
  AppEventLog,
  AppInstallation,
  AppMarketplaceImage,
  AppSetting,
  AppWebhookHandler,
  ConnectionDefinition,
  DeveloperAccount,
  DeveloperAccountInvite,
  DeveloperAccountMember,
  Organization,
  oauthApplication,
  User,
  WorkflowCredentials,
} from '../schema'

/** Relations for DeveloperAccount */
export const developerAccountRelations = relations(DeveloperAccount, ({ many }) => ({
  members: many(DeveloperAccountMember),
  invites: many(DeveloperAccountInvite),
  apps: many(App),
  marketplaceImages: many(AppMarketplaceImage),
  connectionDefinitions: many(ConnectionDefinition),
}))

/** Relations for DeveloperAccountMember */
export const developerAccountMemberRelations = relations(
  DeveloperAccountMember,
  ({ one, many }) => ({
    developerAccount: one(DeveloperAccount, {
      fields: [DeveloperAccountMember.developerAccountId],
      references: [DeveloperAccount.id],
    }),
    user: one(User, {
      fields: [DeveloperAccountMember.userId],
      references: [User.id],
    }),
  })
)

/** Relations for DeveloperAccountInvite */
export const developerAccountInviteRelations = relations(DeveloperAccountInvite, ({ one }) => ({
  developerAccount: one(DeveloperAccount, {
    fields: [DeveloperAccountInvite.developerAccountId],
    references: [DeveloperAccount.id],
  }),
}))

/** Relations for App */
export const appRelations = relations(App, ({ one, many }) => ({
  developerAccount: one(DeveloperAccount, {
    fields: [App.developerAccountId],
    references: [DeveloperAccount.id],
  }),
  oauthApplication: one(oauthApplication, {
    fields: [App.oauthApplicationId],
    references: [oauthApplication.id],
  }),
  bundles: many(AppBundle),
  deployments: many(AppDeployment),
  marketplaceImages: many(AppMarketplaceImage),
  connectionDefinitions: many(ConnectionDefinition),
  eventLogs: many(AppEventLog),
  connections: many(WorkflowCredentials),
}))

/** Relations for AppBundle */
export const appBundleRelations = relations(AppBundle, ({ one }) => ({
  app: one(App, {
    fields: [AppBundle.appId],
    references: [App.id],
  }),
}))

/** Relations for AppDeployment */
export const appDeploymentRelations = relations(AppDeployment, ({ one, many }) => ({
  app: one(App, {
    fields: [AppDeployment.appId],
    references: [App.id],
  }),
  clientBundle: one(AppBundle, {
    fields: [AppDeployment.clientBundleId],
    references: [AppBundle.id],
    relationName: 'clientBundle',
  }),
  serverBundle: one(AppBundle, {
    fields: [AppDeployment.serverBundleId],
    references: [AppBundle.id],
    relationName: 'serverBundle',
  }),
  targetOrganization: one(Organization, {
    fields: [AppDeployment.targetOrganizationId],
    references: [Organization.id],
  }),
  createdBy: one(User, {
    fields: [AppDeployment.createdById],
    references: [User.id],
  }),
  eventLogs: many(AppEventLog),
  settings: many(AppSetting),
}))

/** Relations for AppInstallation */
export const appInstallationRelations = relations(AppInstallation, ({ one, many }) => ({
  app: one(App, {
    fields: [AppInstallation.appId],
    references: [App.id],
  }),
  organization: one(Organization, {
    fields: [AppInstallation.organizationId],
    references: [Organization.id],
  }),
  currentDeployment: one(AppDeployment, {
    fields: [AppInstallation.currentDeploymentId],
    references: [AppDeployment.id],
  }),
  connections: many(WorkflowCredentials),
  webhookHandlers: many(AppWebhookHandler),
  settings: many(AppSetting),
}))

/** Relations for AppSetting */
export const appSettingRelations = relations(AppSetting, ({ one }) => ({
  appInstallation: one(AppInstallation, {
    fields: [AppSetting.appInstallationId],
    references: [AppInstallation.id],
  }),
  appDeployment: one(AppDeployment, {
    fields: [AppSetting.appDeploymentId],
    references: [AppDeployment.id],
  }),
}))

/** Relations for AppWebhookHandler */
export const appWebhookHandlerRelations = relations(AppWebhookHandler, ({ one }) => ({
  appInstallation: one(AppInstallation, {
    fields: [AppWebhookHandler.appInstallationId],
    references: [AppInstallation.id],
  }),
}))

/** Relations for AppMarketplaceImage */
export const appMarketplaceImageRelations = relations(AppMarketplaceImage, ({ one }) => ({
  developerAccount: one(DeveloperAccount, {
    fields: [AppMarketplaceImage.developerAccountId],
    references: [DeveloperAccount.id],
  }),
  app: one(App, {
    fields: [AppMarketplaceImage.appId],
    references: [App.id],
  }),
}))

/** Relations for ConnectionDefinition */
export const connectionDefinitionRelations = relations(ConnectionDefinition, ({ one }) => ({
  developerAccount: one(DeveloperAccount, {
    fields: [ConnectionDefinition.developerAccountId],
    references: [DeveloperAccount.id],
  }),
  app: one(App, {
    fields: [ConnectionDefinition.appId],
    references: [App.id],
  }),
}))

/** Relations for AppEventLog */
export const appEventLogRelations = relations(AppEventLog, ({ one }) => ({
  app: one(App, {
    fields: [AppEventLog.appId],
    references: [App.id],
  }),
  organization: one(Organization, {
    fields: [AppEventLog.organizationId],
    references: [Organization.id],
  }),
  appDeployment: one(AppDeployment, {
    fields: [AppEventLog.appDeploymentId],
    references: [AppDeployment.id],
  }),
}))

/** Relations for oauthApplication */
export const oauthApplicationRelations = relations(oauthApplication, ({ many }) => ({
  apps: many(App),
}))
