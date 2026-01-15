// packages/database/src/db/relations/import.ts
// Relations for data importer tables

import { relations } from 'drizzle-orm/relations'
import {
  ImportMapping,
  ImportMappingProperty,
  ImportJob,
  ImportJobMappableProperty,
  ImportJobProperty,
  ImportJobRawData,
  ImportValueResolution,
  ImportPlan,
  ImportPlanStrategy,
  ImportPlanRow,
  Organization,
  User,
  CustomField,
} from '../schema'

/** Relations for ImportMapping */
export const importMappingRelations = relations(ImportMapping, ({ one, many }) => ({
  organization: one(Organization, {
    fields: [ImportMapping.organizationId],
    references: [Organization.id],
  }),
  createdBy: one(User, {
    fields: [ImportMapping.createdById],
    references: [User.id],
  }),
  properties: many(ImportMappingProperty),
  jobs: many(ImportJob),
}))

/** Relations for ImportMappingProperty */
export const importMappingPropertyRelations = relations(ImportMappingProperty, ({ one }) => ({
  importMapping: one(ImportMapping, {
    fields: [ImportMappingProperty.importMappingId],
    references: [ImportMapping.id],
  }),
  customField: one(CustomField, {
    fields: [ImportMappingProperty.customFieldId],
    references: [CustomField.id],
  }),
}))

/** Relations for ImportJob */
export const importJobRelations = relations(ImportJob, ({ one, many }) => ({
  organization: one(Organization, {
    fields: [ImportJob.organizationId],
    references: [Organization.id],
  }),
  importMapping: one(ImportMapping, {
    fields: [ImportJob.importMappingId],
    references: [ImportMapping.id],
  }),
  createdBy: one(User, {
    fields: [ImportJob.createdById],
    references: [User.id],
  }),
  mappableProperties: many(ImportJobMappableProperty),
  jobProperties: many(ImportJobProperty),
  rawData: many(ImportJobRawData),
  plans: many(ImportPlan),
}))

/** Relations for ImportJobMappableProperty */
export const importJobMappablePropertyRelations = relations(
  ImportJobMappableProperty,
  ({ one }) => ({
    importJob: one(ImportJob, {
      fields: [ImportJobMappableProperty.importJobId],
      references: [ImportJob.id],
    }),
  })
)

/** Relations for ImportJobProperty */
export const importJobPropertyRelations = relations(ImportJobProperty, ({ one, many }) => ({
  importJob: one(ImportJob, {
    fields: [ImportJobProperty.importJobId],
    references: [ImportJob.id],
  }),
  importMappingProperty: one(ImportMappingProperty, {
    fields: [ImportJobProperty.importMappingPropertyId],
    references: [ImportMappingProperty.id],
  }),
  valueResolutions: many(ImportValueResolution),
}))

/** Relations for ImportJobRawData */
export const importJobRawDataRelations = relations(ImportJobRawData, ({ one }) => ({
  importJob: one(ImportJob, {
    fields: [ImportJobRawData.importJobId],
    references: [ImportJob.id],
  }),
}))

/** Relations for ImportValueResolution */
export const importValueResolutionRelations = relations(ImportValueResolution, ({ one }) => ({
  importJobProperty: one(ImportJobProperty, {
    fields: [ImportValueResolution.importJobPropertyId],
    references: [ImportJobProperty.id],
  }),
}))

/** Relations for ImportPlan */
export const importPlanRelations = relations(ImportPlan, ({ one, many }) => ({
  importJob: one(ImportJob, {
    fields: [ImportPlan.importJobId],
    references: [ImportJob.id],
  }),
  strategies: many(ImportPlanStrategy),
}))

/** Relations for ImportPlanStrategy */
export const importPlanStrategyRelations = relations(ImportPlanStrategy, ({ one, many }) => ({
  importPlan: one(ImportPlan, {
    fields: [ImportPlanStrategy.importPlanId],
    references: [ImportPlan.id],
  }),
  matchingCustomField: one(CustomField, {
    fields: [ImportPlanStrategy.matchingCustomFieldId],
    references: [CustomField.id],
  }),
  rows: many(ImportPlanRow),
}))

/** Relations for ImportPlanRow */
export const importPlanRowRelations = relations(ImportPlanRow, ({ one }) => ({
  importPlanStrategy: one(ImportPlanStrategy, {
    fields: [ImportPlanRow.importPlanStrategyId],
    references: [ImportPlanStrategy.id],
  }),
}))
