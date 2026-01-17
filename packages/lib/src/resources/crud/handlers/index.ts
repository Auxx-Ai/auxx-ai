// packages/lib/src/resources/crud/handlers/index.ts

import { createScopedLogger } from '@auxx/logger'
import type { ResourceHandler } from './types'
import { contactHandler } from './contact-handler'
import { ticketHandler } from './ticket-handler'
import { entityHandler } from './entity-handler'

const logger = createScopedLogger('crud-handlers')

/** All registered handlers */
const handlers: ResourceHandler[] = [
  contactHandler,
  ticketHandler,
  entityHandler,
  // Add more handlers here
]

/**
 * Get the handler for a resource type
 */
export function getHandler(resourceType: string): ResourceHandler | null {
  logger.debug('getHandler called', {
    resourceType,
    resourceTypeLength: resourceType?.length,
    handlers: handlers.map((h, i) => {
      try {
        return { index: i, supports: h.supports(resourceType) }
      } catch (e) {
        return { index: i, error: String(e) }
      }
    }),
  })

  const handler = handlers.find((h) => h.supports(resourceType)) ?? null

  logger.debug('getHandler result', {
    resourceType,
    handlerFound: !!handler,
  })

  return handler
}

export { contactHandler, ticketHandler, entityHandler }
export type { ResourceHandler } from './types'
