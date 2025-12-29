// packages/lib/src/resources/crud/handlers/index.ts

import type { ResourceHandler } from './types'
import { contactHandler } from './contact-handler'
import { ticketHandler } from './ticket-handler'
import { entityHandler } from './entity-handler'

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
  return handlers.find((h) => h.supports(resourceType)) ?? null
}

export { contactHandler, ticketHandler, entityHandler }
export type { ResourceHandler } from './types'
