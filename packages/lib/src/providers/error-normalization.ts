// packages/lib/src/providers/error-normalization.ts

export enum EmailErrorCode {
  // Size related
  SIZE_LIMIT_EXCEEDED = 'SIZE_LIMIT_EXCEEDED',
  ATTACHMENT_TOO_LARGE = 'ATTACHMENT_TOO_LARGE',

  // Authentication/Authorization
  AUTH_FAILED = 'AUTH_FAILED',
  FROM_ALIAS_INVALID = 'FROM_ALIAS_INVALID',
  SEND_AS_DENIED = 'SEND_AS_DENIED',

  // Rate limiting
  RATE_LIMIT = 'RATE_LIMIT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  // Network/Service
  NETWORK_ERROR = 'NETWORK_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  // Attachment specific
  ATTACHMENT_ENCODING_FAILED = 'ATTACHMENT_ENCODING_FAILED',
  ATTACHMENT_NOT_FOUND = 'ATTACHMENT_NOT_FOUND',
  INVALID_ATTACHMENT_FORMAT = 'INVALID_ATTACHMENT_FORMAT',

  // General
  INVALID_RECIPIENTS = 'INVALID_RECIPIENTS',
  INVALID_MESSAGE_FORMAT = 'INVALID_MESSAGE_FORMAT',
  /** The provider rejected an internet (RFC 5322) message header outright. */
  INVALID_MESSAGE_HEADER = 'INVALID_MESSAGE_HEADER',
  UNKNOWN = 'UNKNOWN',
}

/** Cap on persisted raw provider text — enough for a Graph body, not a log dump. */
const MAX_RAW_PROVIDER_ERROR_LENGTH = 2000

function stringifyBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body
  if (!body || typeof body !== 'object') return undefined
  try {
    return JSON.stringify(body)
  } catch {
    return undefined
  }
}

/**
 * Best-effort raw provider error text, for persisting alongside the sanitized
 * user-facing message.
 *
 * The normalized `message` is written for humans and the provider's own text —
 * the one line that says *why* the send was refused (e.g. Graph's
 * `InvalidInternetMessageHeader: … should start with 'x-'`) — used to exist only
 * in a log line. This pulls that text back out of the thrown error (unwrapping a
 * `NormalizedEmailError` if that is what it is handed) so a failed send is
 * diagnosable from the database.
 */
export function extractProviderErrorText(error: unknown): string | undefined {
  if (!error) return undefined
  if (typeof error === 'string') return error.slice(0, MAX_RAW_PROVIDER_ERROR_LENGTH) || undefined

  const wrapper = error as Record<string, any>
  // A NormalizedEmailError carries the provider's own error on `originalError`.
  const source: Record<string, any> = wrapper.originalError ?? wrapper

  const parts: string[] = []
  const message = typeof source.message === 'string' ? source.message : undefined
  if (message) parts.push(message)

  const bodyText = stringifyBody(source.body ?? source.responseBody ?? source.response?.body)
  if (bodyText && bodyText !== message) parts.push(bodyText)

  if (parts.length === 0 && typeof wrapper.message === 'string') parts.push(wrapper.message)

  const text = parts.join(' | ').trim()
  return text ? text.slice(0, MAX_RAW_PROVIDER_ERROR_LENGTH) : undefined
}

export class NormalizedEmailError extends Error {
  constructor(
    public code: EmailErrorCode,
    message: string,
    public originalError?: any,
    public details?: {
      provider?: string
      filename?: string
      size?: number
      limit?: number
      retryable?: boolean
      userMessage?: string
    }
  ) {
    super(message)
    this.name = 'NormalizedEmailError'
  }
}

export class ErrorNormalizer {
  static normalizeGmailError(error: any): NormalizedEmailError {
    const status = error.code || error.status
    const message = error.message || ''

    // Size errors
    if (status === 413 || message.includes('Message exceeds maximum size')) {
      return new NormalizedEmailError(
        EmailErrorCode.SIZE_LIMIT_EXCEEDED,
        'Message exceeds Gmail size limit (25MB including encoding overhead)',
        error,
        { provider: 'gmail', limit: 25 * 1024 * 1024, retryable: false }
      )
    }

    // Auth errors
    if (status === 401 || status === 403) {
      if (message.includes('send-as')) {
        return new NormalizedEmailError(
          EmailErrorCode.FROM_ALIAS_INVALID,
          'From address is not a verified send-as address',
          error,
          { provider: 'gmail', retryable: false }
        )
      }
      return new NormalizedEmailError(
        EmailErrorCode.AUTH_FAILED,
        'Gmail authentication failed',
        error,
        { provider: 'gmail', retryable: false }
      )
    }

    // Rate limiting
    if (status === 429 || message.includes('quota')) {
      return new NormalizedEmailError(
        EmailErrorCode.RATE_LIMIT,
        'Gmail API rate limit exceeded',
        error,
        { provider: 'gmail', retryable: true }
      )
    }

    // Invalid recipients
    if (status === 400 && message.includes('recipient')) {
      return new NormalizedEmailError(
        EmailErrorCode.INVALID_RECIPIENTS,
        'One or more recipient addresses are invalid',
        error,
        { provider: 'gmail', retryable: false }
      )
    }

    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return new NormalizedEmailError(
        EmailErrorCode.NETWORK_ERROR,
        'Network error connecting to Gmail',
        error,
        { provider: 'gmail', retryable: true }
      )
    }

    return new NormalizedEmailError(EmailErrorCode.UNKNOWN, `Gmail error: ${message}`, error, {
      provider: 'gmail',
      retryable: false,
    })
  }

  static normalizeOutlookError(error: any): NormalizedEmailError {
    const status = error.statusCode || error.status
    const message = error.message || ''

    // Size errors
    if (status === 413 || message.includes('RequestEntityTooLarge')) {
      return new NormalizedEmailError(
        EmailErrorCode.SIZE_LIMIT_EXCEEDED,
        'Message exceeds Outlook size limit (10MB total)',
        error,
        { provider: 'outlook', limit: 10 * 1024 * 1024, retryable: false }
      )
    }

    // Auth errors
    if (status === 401) {
      return new NormalizedEmailError(
        EmailErrorCode.AUTH_FAILED,
        'Outlook authentication failed',
        error,
        { provider: 'outlook', retryable: false }
      )
    }

    // Rate limiting
    if (status === 429) {
      return new NormalizedEmailError(
        EmailErrorCode.RATE_LIMIT,
        'Microsoft Graph API rate limit exceeded',
        error,
        { provider: 'outlook', retryable: true }
      )
    }

    // Service errors
    if (status >= 500) {
      return new NormalizedEmailError(
        EmailErrorCode.SERVICE_UNAVAILABLE,
        'Microsoft Graph service temporarily unavailable',
        error,
        { provider: 'outlook', retryable: true }
      )
    }

    // Rejected internet message header. Graph accepts ONLY `x-`-prefixed names in
    // `internetMessageHeaders` and answers 400 `InvalidInternetMessageHeader` —
    // it rejects the whole request rather than dropping the header. This must
    // stay ahead of the UNKNOWN fallthrough, which discards the one line that
    // names the offending header.
    const graphCode = typeof error?.code === 'string' ? error.code : ''
    const bodyText = stringifyBody(error?.body ?? error?.responseBody ?? error?.response?.body)
    if (/invalidinternetmessageheader/i.test(`${graphCode} ${bodyText ?? ''} ${message}`)) {
      const raw = extractProviderErrorText(error) ?? message
      return new NormalizedEmailError(
        EmailErrorCode.INVALID_MESSAGE_HEADER,
        `Outlook rejected a message header: ${raw}`,
        error,
        { provider: 'outlook', retryable: false }
      )
    }

    return new NormalizedEmailError(EmailErrorCode.UNKNOWN, `Outlook error: ${message}`, error, {
      provider: 'outlook',
      retryable: false,
    })
  }

  static getUserMessage(error: NormalizedEmailError): string {
    switch (error.code) {
      case EmailErrorCode.SIZE_LIMIT_EXCEEDED: {
        const limitMB = error.details?.limit ? (error.details.limit / 1024 / 1024).toFixed(0) : '25'
        return `Message too large (max ${limitMB}MB). Try removing attachments or using cloud storage links.`
      }

      case EmailErrorCode.FROM_ALIAS_INVALID:
        return 'The selected "From" address is not verified for sending. Please check your email settings.'

      case EmailErrorCode.RATE_LIMIT:
        return 'Sending limit reached. Please wait a moment and try again.'

      case EmailErrorCode.AUTH_FAILED:
        return 'Email authentication failed. Please reconnect your email account.'

      case EmailErrorCode.NETWORK_ERROR:
        return 'Network connection issue. Please check your internet and try again.'

      case EmailErrorCode.INVALID_RECIPIENTS:
        return 'One or more recipient email addresses are invalid.'

      case EmailErrorCode.INVALID_MESSAGE_HEADER:
        return 'The email provider refused a header on this message, so nothing was sent. Retrying will not help until the message is rebuilt — please report this with the message ID.'

      case EmailErrorCode.ATTACHMENT_ENCODING_FAILED:
        return `Failed to process attachment${error.details?.filename ? ` "${error.details.filename}"` : ''}. Please try removing and re-adding the file.`

      default:
        return error.details?.userMessage || 'Failed to send message. Please try again.'
    }
  }
}
