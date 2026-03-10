// packages/lib/src/providers/imap/utils/parse-imap-error.ts

import { BadRequestError, UnauthorizedError } from '../../../errors'

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
])

export function parseImapConnectionError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new BadRequestError('Unknown IMAP connection error')
  }

  const imapError = error as {
    authenticationFailed?: boolean
    code?: string
    responseCode?: string
  }

  if (imapError.authenticationFailed || imapError.responseCode === 'AUTHENTICATIONFAILED') {
    return new UnauthorizedError(`IMAP authentication failed: ${error.message}`)
  }

  if (imapError.code && NETWORK_ERROR_CODES.has(imapError.code)) {
    return new BadRequestError(`IMAP network error: ${imapError.code} - ${error.message}`)
  }

  if (error.message.toLowerCase().includes('timeout')) {
    return new BadRequestError(`IMAP timeout: ${error.message}`)
  }

  return new BadRequestError(`IMAP connection error: ${error.message}`)
}

export function parseImapSyncError(error: unknown): Error {
  if (error instanceof UnauthorizedError || error instanceof BadRequestError) {
    return error
  }

  if (!(error instanceof Error)) {
    return new BadRequestError('Unknown IMAP sync error')
  }

  const imapError = error as { code?: string }

  if (imapError.code && NETWORK_ERROR_CODES.has(imapError.code)) {
    return new BadRequestError(`IMAP network error: ${imapError.code} - ${error.message}`)
  }

  if (error.message.toLowerCase().includes('timeout')) {
    return new BadRequestError(`IMAP timeout: ${error.message}`)
  }

  if (error.message.includes('UID validity')) {
    return new BadRequestError(`IMAP UID validity changed: ${error.message}`)
  }

  return new BadRequestError(`IMAP error: ${error.message}`)
}
