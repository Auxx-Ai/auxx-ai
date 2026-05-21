// apps/api/src/routes/chat/attachments.ts

import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { applyChatCorsHeaders, getChatService } from './lib'

const log = createScopedLogger('chat-attachments-route')

const attachmentsRoute = new Hono()

attachmentsRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/attachments (multipart/form-data)
 *
 * Body fields: `sessionId`, `file`. Phase 4 swaps internals to the unified
 * file/attachment service.
 */
attachmentsRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'Expected multipart body' } },
      400
    )
  }

  const sessionId = form.get('sessionId')
  const file = form.get('file')
  if (typeof sessionId !== 'string' || !(file instanceof Blob)) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'sessionId and file are required' },
      },
      400
    )
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const service = getChatService()
    const attachment = await service.uploadAttachment({
      sessionId,
      fileName: 'name' in file && typeof file.name === 'string' ? file.name : 'attachment',
      fileType: file.type || 'application/octet-stream',
      fileSize: buffer.length,
      fileBuffer: buffer,
    })
    return c.json({ success: true, data: attachment })
  } catch (error) {
    log.error('Failed to upload chat attachment', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to upload attachment' } },
      500
    )
  }
})

export default attachmentsRoute
