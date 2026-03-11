// apps/worker/src/inbound-email/dev-inbound-email.ts

import { randomUUID } from 'node:crypto'
import type { RawEmailStore, SesInboundQueueMessage } from '@auxx/lib/email'
import { Hono } from 'hono'

/**
 * supportedContentTypes lists MIME types the dev harness accepts for raw inbound email requests.
 */
const supportedContentTypes = ['text/plain', 'message/rfc822']

/**
 * InboundErrorResponseBody is the JSON payload returned when the dev endpoint rejects a request.
 */
interface InboundErrorResponseBody {
  error: string
}

/**
 * InboundSuccessResponseBody is the JSON payload returned when the dev endpoint processes a request.
 */
interface InboundSuccessResponseBody {
  ok: true
  sesMessageId: string
  recipients: string[]
}

/**
 * ProcessDevInboundEmailParams is the normalized input passed from the route to the processor.
 */
interface ProcessDevInboundEmailParams {
  queueMessage: SesInboundQueueMessage
  rawEmail: string
}

/**
 * ProcessDevInboundEmailFn processes one synthetic inbound queue message from the dev harness.
 */
type ProcessDevInboundEmailFn = (params: ProcessDevInboundEmailParams) => Promise<void>

/**
 * CreateDevInboundEmailRoutesOptions configures injectable behaviors for route testing.
 */
interface CreateDevInboundEmailRoutesOptions {
  processDevInboundEmail?: ProcessDevInboundEmailFn
  createSesMessageId?: () => string
  now?: () => Date
}

/**
 * InlineRawEmailStore returns a preloaded raw MIME string and ignores the requested bucket/key.
 */
class InlineRawEmailStore implements RawEmailStore {
  /**
   * rawEmail is the MIME payload provided by the incoming HTTP request.
   */
  private rawEmail: string

  /**
   * constructor stores the request payload for later reads by the processor.
   */
  constructor(rawEmail: string) {
    this.rawEmail = rawEmail
  }

  /**
   * getRawEmailString returns the preloaded MIME payload for the synthetic queue message.
   */
  async getRawEmailString(_bucket: string, _key: string): Promise<string> {
    return this.rawEmail
  }
}

/**
 * normalizeRecipients converts a comma-separated list of recipients into a normalized array.
 */
function normalizeRecipients(value: string | undefined): string[] {
  if (!value) return []

  return value
    .split(',')
    .map((recipient) => recipient.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * getRecipients extracts recipients from the query string or request header.
 */
function getRecipients(request: Request): string[] {
  const url = new URL(request.url)
  const queryRecipients = normalizeRecipients(url.searchParams.get('recipients') ?? undefined)
  if (queryRecipients.length > 0) return queryRecipients

  return normalizeRecipients(request.headers.get('x-recipients') ?? undefined)
}

/**
 * isSupportedContentType checks whether the request content type is accepted by the dev harness.
 */
function isSupportedContentType(contentType: string): boolean {
  return supportedContentTypes.some((supportedType) => contentType.startsWith(supportedType))
}

/**
 * isUnprocessableInboundError checks whether an error should be reported as a 422 response.
 */
function isUnprocessableInboundError(error: Error): boolean {
  return (
    error.message.includes('No active forwarding integration found') ||
    error.message.includes('is not allowed for this forwarding integration') ||
    error.message.includes('missing a sender address')
  )
}

/**
 * buildUnsupportedContentTypeResponse returns a 415 JSON response for invalid content types.
 */
function buildUnsupportedContentTypeResponse() {
  return Response.json(
    {
      error: `Unsupported content type. Expected one of: ${supportedContentTypes.join(', ')}`,
    },
    { status: 415 }
  )
}

/**
 * buildBadRequestResponse returns a 400 JSON response for invalid request input.
 */
function buildBadRequestResponse(error: string) {
  return Response.json({ error }, { status: 400 })
}

/**
 * defaultProcessDevInboundEmail runs the existing inbound processor with an inline raw-email store.
 */
async function defaultProcessDevInboundEmail(params: ProcessDevInboundEmailParams): Promise<void> {
  const { InboundEmailProcessor } = await import('@auxx/lib/email')

  const processor = new InboundEmailProcessor({
    rawEmailStore: new InlineRawEmailStore(params.rawEmail),
    inboundSource: 'dev-harness',
  })

  await processor.processFromQueueMessage(params.queueMessage)
}

/**
 * createDevInboundEmailRoutes creates the dev-only inbound email route set.
 */
export function createDevInboundEmailRoutes(options: CreateDevInboundEmailRoutesOptions = {}) {
  const app = new Hono()
  const processDevInboundEmail = options.processDevInboundEmail ?? defaultProcessDevInboundEmail
  const createSesMessageId = options.createSesMessageId ?? (() => `dev-${randomUUID()}`)
  const now = options.now ?? (() => new Date())

  app.post('/dev/inbound-email', async (c) => {
    const contentType = c.req.header('content-type')?.toLowerCase() ?? ''
    if (!isSupportedContentType(contentType)) {
      return buildUnsupportedContentTypeResponse()
    }

    const recipients = getRecipients(c.req.raw)
    if (recipients.length === 0) {
      return buildBadRequestResponse(
        'Recipients are required via the recipients query parameter or X-Recipients header'
      )
    }

    const rawEmail = await c.req.text()
    if (rawEmail.trim().length === 0) {
      return buildBadRequestResponse('Raw email body is required')
    }

    const sesMessageId = createSesMessageId()
    const queueMessage: SesInboundQueueMessage = {
      version: 1,
      provider: 'ses',
      sesMessageId,
      s3Bucket: 'dev-inline',
      s3Key: `dev/${sesMessageId}.eml`,
      recipients,
      receivedAt: now().toISOString(),
    }

    try {
      await processDevInboundEmail({
        queueMessage,
        rawEmail,
      })

      return c.json<InboundSuccessResponseBody>({
        ok: true,
        sesMessageId,
        recipients,
      })
    } catch (error) {
      if (error instanceof Error && isUnprocessableInboundError(error)) {
        return c.json<InboundErrorResponseBody>({ error: error.message }, 422)
      }

      if (error instanceof Error) {
        return c.json<InboundErrorResponseBody>({ error: error.message }, 500)
      }

      return c.json<InboundErrorResponseBody>({ error: 'Internal Server Error' }, 500)
    }
  })

  return app
}

/**
 * devInboundEmailRoutes is the default route instance mounted by the worker server in non-production.
 */
export const devInboundEmailRoutes = createDevInboundEmailRoutes()
