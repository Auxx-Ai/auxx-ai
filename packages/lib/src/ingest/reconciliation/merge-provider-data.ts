// packages/lib/src/ingest/reconciliation/merge-provider-data.ts

import { schema } from '@auxx/database'
import type { MessageEntity as Message } from '@auxx/database/types'
import { eq } from 'drizzle-orm'
import type { IngestContext } from '../context'
import type { MessageData } from '../types'

/**
 * Merge provider-sourced data into an existing message row. Preserves any
 * user-authored fields on the row (text, html, snippet) when the provider
 * update would blank them, and marks metadata as reconciled.
 */
export async function mergeProviderData(
  ctx: IngestContext,
  existing: Message,
  providerData: MessageData
): Promise<Message> {
  const mergedMetadata = {
    ...((existing.metadata as any) || {}),
    ...((providerData.metadata as any) || {}),
    reconciled: true,
    reconciledAt: new Date().toISOString(),
  } as any

  const [row] = await ctx.db
    .update(schema.Message)
    .set({
      textPlain: existing.textPlain ?? providerData.textPlain,
      textHtml: existing.textHtml ?? providerData.textHtml,
      snippet: existing.snippet ?? providerData.snippet,
      externalId: providerData.externalId ?? existing.externalId,
      externalThreadId: providerData.externalThreadId ?? existing.externalThreadId,
      hasAttachments: providerData.hasAttachments ?? existing.hasAttachments,
      sendStatus: existing.sendStatus === 'PENDING' ? 'SENT' : existing.sendStatus,
      metadata: mergedMetadata,
    })
    .where(eq(schema.Message.id, existing.id))
    .returning()

  return row
}
