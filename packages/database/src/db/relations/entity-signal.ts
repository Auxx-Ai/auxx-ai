// packages/database/src/db/relations/entity-signal.ts
// Hand-written relations for the EntitySignal substrate (see
// plans/dispatch/19-client-notifications.md §4.1). Mirrors the style of ../relations/sequence.ts.

import { relations } from 'drizzle-orm/relations'
import {
  EntityInstance,
  EntitySignal,
  EntitySignalLink,
  EntitySignalRollup,
  Organization,
} from '../schema'

export const entitySignalRelations = relations(EntitySignal, ({ one, many }) => ({
  organization: one(Organization, {
    fields: [EntitySignal.organizationId],
    references: [Organization.id],
  }),
  contact: one(EntityInstance, {
    fields: [EntitySignal.contactEntityInstanceId],
    references: [EntityInstance.id],
  }),
  links: many(EntitySignalLink),
}))

export const entitySignalLinkRelations = relations(EntitySignalLink, ({ one }) => ({
  organization: one(Organization, {
    fields: [EntitySignalLink.organizationId],
    references: [Organization.id],
  }),
  signal: one(EntitySignal, {
    fields: [EntitySignalLink.signalId],
    references: [EntitySignal.id],
  }),
}))

export const entitySignalRollupRelations = relations(EntitySignalRollup, ({ one }) => ({
  organization: one(Organization, {
    fields: [EntitySignalRollup.organizationId],
    references: [Organization.id],
  }),
  entityInstance: one(EntityInstance, {
    fields: [EntitySignalRollup.entityInstanceId],
    references: [EntityInstance.id],
  }),
}))
