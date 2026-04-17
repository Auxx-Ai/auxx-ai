// apps/api/src/routes/free-tool-leads.ts

import { database, FreeToolLead } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { errorResponse, successResponse } from '../lib/response'

const log = createScopedLogger('free-tool-leads')

const ALLOWED_SLUGS = new Set([
  'invoice-generator',
  'customer-support-email-templates',
  'refund-request-response-templates',
  'shipping-delay-email-templates',
  'sla-calculator',
  'first-response-time-calculator',
  'email-signature-generator',
  'customer-support-kpis',
])
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const freeToolLeads = new Hono()

freeToolLeads.post(
  '/',
  bodyLimit({
    maxSize: 4 * 1024,
    onError: (c) => c.json(errorResponse('BAD_REQUEST', 'Payload too large'), 400),
  }),
  async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return c.json(errorResponse('BAD_REQUEST', 'Invalid JSON body'), 400)
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const toolSlug = typeof body.toolSlug === 'string' ? body.toolSlug.trim() : ''

    if (!EMAIL_REGEX.test(email)) {
      return c.json(errorResponse('BAD_REQUEST', 'A valid email is required'), 400)
    }
    if (!ALLOWED_SLUGS.has(toolSlug)) {
      return c.json(errorResponse('BAD_REQUEST', 'Unknown toolSlug'), 400)
    }

    // Honeypot — silently accept and drop if the hidden field is filled in
    if (typeof body.website === 'string' && body.website.length > 0) {
      return c.json(successResponse({ ok: true }))
    }

    try {
      await database.insert(FreeToolLead).values({
        email,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null,
        toolSlug,
        referrer: c.req.header('referer') ?? null,
        userAgent: c.req.header('user-agent') ?? null,
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        utmSource: typeof body.utmSource === 'string' ? body.utmSource : null,
        utmMedium: typeof body.utmMedium === 'string' ? body.utmMedium : null,
        utmCampaign: typeof body.utmCampaign === 'string' ? body.utmCampaign : null,
      })
      return c.json(successResponse({ ok: true }))
    } catch (error) {
      log.error('Failed to insert free-tool lead', { error, toolSlug })
      return c.json(errorResponse('INTERNAL_ERROR', 'Failed to save lead'), 500)
    }
  }
)

export default freeToolLeads
