// packages/lib/src/ai/mcp/errors.ts

import {
  type AuxxError,
  BadRequestError,
  ForbiddenError,
  RateLimitError,
  UnauthorizedError,
} from '../../errors'

/**
 * Thrown by the client when the transport reports a 401. Carries the raw `WWW-Authenticate`
 * header so phase-4 discovery can parse RFC 9728 resource metadata, and so the tool adapter
 * can flag the connection for reconnect.
 */
export class McpAuthError extends Error {
  readonly status: number
  readonly wwwAuthenticate?: string
  constructor(message: string, opts: { status: number; wwwAuthenticate?: string }) {
    super(message)
    this.name = 'McpAuthError'
    this.status = opts.status
    this.wwwAuthenticate = opts.wwwAuthenticate
  }
}

/** A mapped MCP error: a stable code + human message, plus the AuxxError class where it maps. */
export interface MappedMcpError {
  code: string
  message: string
  auxxError?: AuxxError
}

/**
 * Map an SDK / transport / JSON-RPC error to a stable code + message. Never throws — callers
 * turn the result into a tool-result error (the model can read it and back off).
 */
export function mapMcpError(e: unknown): MappedMcpError {
  // Auth failures carry HTTP status from the transport.
  if (e instanceof McpAuthError) {
    if (e.status === 403) {
      return {
        code: 'forbidden',
        message: 'MCP server denied access (403).',
        auxxError: new ForbiddenError('MCP server denied access'),
      }
    }
    return {
      code: 'unauthorized',
      message: 'MCP server authentication failed (401).',
      auxxError: new UnauthorizedError('MCP server authentication failed'),
    }
  }

  // JSON-RPC error object: { code, message }
  const rpcCode = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined
  const message =
    typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string'
      ? (e as { message: string }).message
      : 'MCP request failed'

  if (rpcCode === -32602) {
    return {
      code: 'invalid_params',
      message: `Invalid tool arguments: ${message}`,
      auxxError: new BadRequestError(message),
    }
  }

  // HTTP status codes surfaced via StreamableHTTPError.code or a `.status` property.
  const httpStatus = typeof rpcCode === 'number' && rpcCode >= 100 ? rpcCode : undefined
  if (httpStatus === 401) {
    return {
      code: 'unauthorized',
      message: 'MCP server authentication failed (401).',
      auxxError: new UnauthorizedError('MCP server authentication failed'),
    }
  }
  if (httpStatus === 403) {
    return {
      code: 'forbidden',
      message: 'MCP server denied access (403).',
      auxxError: new ForbiddenError('MCP server denied access'),
    }
  }
  if (httpStatus === 429) {
    return {
      code: 'rate_limited',
      message: 'MCP server rate limited the request (429).',
      auxxError: new RateLimitError('MCP server rate limited the request'),
    }
  }

  return { code: 'mcp_error', message }
}
