// packages/database/src/db/relations/accounting.ts
import { relations } from 'drizzle-orm/relations'
import {
  ExternalAccountingBook,
  ExternalBookConnection,
  GlPosting,
  GlPostingSource,
} from '../schema'

export const glPostingSourceRelations = relations(GlPostingSource, ({ one }) => ({
  posting: one(GlPosting, {
    fields: [GlPostingSource.organizationId, GlPostingSource.glPostingId],
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
