// apps/web/src/app/api/messages/[messageId]/body/route.ts

import type { NextRequest } from 'next/server'
export const runtime = 'nodejs'

import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'
import { auth } from '~/auth/server'

const logger = createScopedLogger('api-messages-body')

interface RouteParams {
  params: Promise<{ messageId: string }>
}

/**
 * GET /api/messages/[messageId]/body
 * Returns a signed URL for the inbound message HTML body stored in object storage.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { messageId } = await params
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return Response.json({ error: 'Organization required' }, { status: 403 })
    }

    const { InboundBodyAccessService } = await import('@auxx/lib/email')
    const bodyAccessService = new InboundBodyAccessService()

    const downloadRef = await bodyAccessService.getHtmlBodyUrl({
      messageId,
      organizationId,
    })

    if (downloadRef.type !== 'url' || !downloadRef.url) {
      return Response.json({ error: 'Body not available' }, { status: 404 })
    }

    return Response.json({ signedUrl: downloadRef.url })
  } catch (error: any) {
    if (error?.statusCode === 404 || error?.name === 'NotFoundError') {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    logger.error('Message body error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
