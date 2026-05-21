// packages/lib/src/chat/metadata.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { ChatThreadMetadata } from '../threads/types'
import type { ServiceContext } from './types'

/** Read the typed chat metadata blob off a Thread row. */
export async function getChatThreadMetadata(
  ctx: ServiceContext,
  threadId: string
): Promise<ChatThreadMetadata | null> {
  const [row] = await ctx.db
    .select({ metadata: schema.Thread.metadata })
    .from(schema.Thread)
    .where(eq(schema.Thread.id, threadId))
    .limit(1)
  if (!row?.metadata) return null
  const meta = row.metadata as Partial<ChatThreadMetadata>
  if (meta.channel !== 'chat') return null
  return meta as ChatThreadMetadata
}

/**
 * Merge a partial patch into `Thread.metadata`. Skips when the thread isn't
 * a chat thread (defensive — caller should already know).
 */
export async function patchChatThreadMetadata(
  ctx: ServiceContext,
  threadId: string,
  patch: Partial<ChatThreadMetadata>
): Promise<void> {
  const current = await getChatThreadMetadata(ctx, threadId)
  if (!current) return
  const merged: ChatThreadMetadata = {
    ...current,
    ...patch,
    visit: { ...(current.visit ?? {}), ...(patch.visit ?? {}) },
  }
  await ctx.db
    .update(schema.Thread)
    .set({ metadata: merged, updatedAt: new Date() })
    .where(eq(schema.Thread.id, threadId))
}
