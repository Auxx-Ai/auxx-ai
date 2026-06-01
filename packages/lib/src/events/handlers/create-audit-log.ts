// packages/lib/src/events/handlers/create-audit-log.ts
// Path-B audit writer: projects the account-level domain events that already flow
// through the bus into immutable AuditLog rows (the customer-visible activity lens).
// No request context here (worker, not HTTP) → no IP/UA; security events that need
// those are written directly at the request layer (Path A). The two paths own disjoint
// event sets — see plans/log/01-implementation-plan.md §3.

import { createScopedLogger } from '@auxx/logger'
import type { AuditInput } from '../../audit-log'
import { recordAudit } from '../../audit-log'
import type {
  AuxxEvent,
  IntegrationConnectedEvent,
  IntegrationConnectionFailedEvent,
  MembershipCreatedEvent,
  ShopifyConnectedEvent,
} from '../types'

const logger = createScopedLogger('handler:create-audit-log')

export const createAuditLog = async ({ data: event }: { data: AuxxEvent }) => {
  const inputs = mapEventToAudit(event)
  if (inputs.length === 0) return

  for (const input of inputs) {
    const result = await recordAudit(input)
    if (result.isErr()) {
      logger.error('Failed to write audit log', {
        eventType: event.type,
        action: input.action,
        error: result.error.message,
      })
      // Throw so BullMQ retries — a dropped audit row is a compliance gap.
      throw new Error(result.error.message)
    }
    logger.info('Audit event recorded', { eventType: event.type, action: input.action })
  }
}

/** Map a bus event to 0..n AuditLog inputs. Only Path-B (account-level) events here. */
function mapEventToAudit(event: AuxxEvent): AuditInput[] {
  switch (event.type) {
    case 'membership:created': {
      const data = event.data as MembershipCreatedEvent['data']
      return [
        {
          organizationId: data.organizationId,
          category: 'members',
          action: 'member.invited',
          actorType: 'user',
          actorId: data.invitedById,
          targetType: 'OrganizationMember',
          targetId: data.userId ?? data.email,
          metadata: {
            email: data.email,
            role: data.role,
            status: data.status,
            isNewUser: data.isNewUser,
          },
          visibility: 'admin',
        },
      ]
    }

    case 'integration:connected': {
      const data = event.data as IntegrationConnectedEvent['data']
      return [
        {
          organizationId: data.organizationId,
          category: 'integrations',
          action: 'integration.connected',
          actorType: 'user',
          actorId: data.userId,
          targetType: 'Integration',
          targetId: data.integrationId ?? null,
          metadata: { provider: data.provider, identifier: data.identifier },
          visibility: 'admin',
        },
      ]
    }

    case 'integration:connection_failed': {
      const data = event.data as IntegrationConnectionFailedEvent['data']
      return [
        {
          organizationId: data.organizationId ?? null,
          category: 'integrations',
          action: 'integration.connection_failed',
          actorType: data.userId ? 'user' : 'system',
          actorId: data.userId ?? null,
          targetType: 'Integration',
          metadata: { provider: data.provider, error: data.error },
          visibility: 'admin',
        },
      ]
    }

    case 'shopify:connected': {
      const data = event.data as ShopifyConnectedEvent['data']
      return [
        {
          organizationId: data.organizationId,
          category: 'integrations',
          action: 'integration.shopify_connected',
          actorType: 'user',
          actorId: data.userId,
          targetType: 'Integration',
          targetId: data.integrationId,
          metadata: { shopDomain: data.shopDomain },
          visibility: 'admin',
        },
      ]
    }

    default:
      return []
  }
}
