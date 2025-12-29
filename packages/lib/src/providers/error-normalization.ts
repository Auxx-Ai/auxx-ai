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
  UNKNOWN = 'UNKNOWN',
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

    return new NormalizedEmailError(EmailErrorCode.UNKNOWN, `Outlook error: ${message}`, error, {
      provider: 'outlook',
      retryable: false,
    })
  }

  static getUserMessage(error: NormalizedEmailError): string {
    switch (error.code) {
      case EmailErrorCode.SIZE_LIMIT_EXCEEDED:
        const limitMB = error.details?.limit ? (error.details.limit / 1024 / 1024).toFixed(0) : '25'
        return `Message too large (max ${limitMB}MB). Try removing attachments or using cloud storage links.`

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

      case EmailErrorCode.ATTACHMENT_ENCODING_FAILED:
        return `Failed to process attachment${error.details?.filename ? ` "${error.details.filename}"` : ''}. Please try removing and re-adding the file.`

      default:
        return error.details?.userMessage || 'Failed to send message. Please try again.'
    }
  }
}
