// packages/database/src/db/relations/accounting.ts
import { relations } from 'drizzle-orm/relations'
import {
  AccountingEffect,
  AccountingWork,
  AccountingWorkBasis,
  EntityInstance,
  ExternalAccountingBook,
  ExternalBookConnection,
  GlPosting,
} from '../schema'

export const accountingWorkRelations = relations(AccountingWork, ({ one, many }) => ({
  source: one(EntityInstance, {
    fields: [AccountingWork.organizationId, AccountingWork.entityInstanceId],
    references: [EntityInstance.organizationId, EntityInstance.id],
  }),
  bases: many(AccountingWorkBasis),
}))
export const accountingWorkBasisRelations = relations(AccountingWorkBasis, ({ one }) => ({
  work: one(AccountingWork, {
    fields: [AccountingWorkBasis.organizationId, AccountingWorkBasis.workId],
    references: [AccountingWork.organizationId, AccountingWork.id],
  }),
}))
export const accountingEffectRelations = relations(AccountingEffect, ({ one }) => ({
  basis: one(AccountingWorkBasis, {
    fields: [
      AccountingEffect.organizationId,
      AccountingEffect.workId,
      AccountingEffect.basisVersion,
    ],
    references: [
      AccountingWorkBasis.organizationId,
      AccountingWorkBasis.workId,
      AccountingWorkBasis.version,
    ],
  }),
  posting: one(GlPosting, {
    fields: [AccountingEffect.organizationId, AccountingEffect.glPostingId],
    references: [GlPosting.organizationId, GlPosting.id],
  }),
}))
export const externalAccountingBookRelations = relations(ExternalAccountingBook, ({ many }) => ({
  connections: many(ExternalBookConnection),
}))
export const externalBookConnectionRelations = relations(ExternalBookConnection, ({ one }) => ({
  book: one(ExternalAccountingBook, {
    fields: [ExternalBookConnection.organizationId, ExternalBookConnection.bookId],
    references: [ExternalAccountingBook.organizationId, ExternalAccountingBook.id],
  }),
}))
