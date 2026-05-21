// apps/api/src/middleware/chat-passport.ts

import type { VerifiedChatPassport } from '@auxx/credentials/passport'
import { verifyChatPassport } from '@auxx/credentials/passport'
import { createScopedLogger } from '@auxx/logger'
import type { MiddlewareHandler } from 'hono'

const log = createScopedLogger('chat-passport-middleware')

declare module 'hono' {
  interface ContextVariableMap {
    chat: VerifiedChatPassport
  }
}

/**
 * Reads `Authorization: Bearer <token>`, verifies via {@link verifyChatPassport},
 * and exposes the claims on `c.var.chat`. 401 on missing / invalid / expired.
 */
export const chatPassportMiddleware: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization') || c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null

  if (!token) {
    return c.json(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing chat passport' },
      },
      401
    )
  }

  const result = await verifyChatPassport(token)
  if (result.isErr()) {
    log.debug('Chat passport verification failed', { code: result.error.code })
    return c.json(
      {
        success: false,
        error: {
          code: result.error.code === 'PASSPORT_EXPIRED' ? 'PASSPORT_EXPIRED' : 'UNAUTHORIZED',
          message: result.error.message,
        },
      },
      401
    )
  }

  c.set('chat', result.value)
  return next()
}
