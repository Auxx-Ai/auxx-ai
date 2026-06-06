// packages/sdk/src/shared/errors.ts

/**
 * Base error class for all Auxx extension errors.
 */
export class AuxxError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'AuxxError'
  }
}

/**
 * Error thrown when extension bundle fails to load.
 */
export class ExtensionLoadError extends AuxxError {
  constructor(message: string) {
    super(message, 'EXTENSION_LOAD_ERROR')
    this.name = 'ExtensionLoadError'
  }
}

/**
 * Error thrown when extension initialization fails.
 */
export class ExtensionInitError extends AuxxError {
  constructor(message: string) {
    super(message, 'EXTENSION_INIT_ERROR')
    this.name = 'ExtensionInitError'
  }
}

/**
 * Error thrown when rendering fails.
 */
export class RenderError extends AuxxError {
  constructor(message: string) {
    super(message, 'RENDER_ERROR')
    this.name = 'RenderError'
  }
}

/**
 * Error thrown when message communication fails.
 */
export class MessageError extends AuxxError {
  constructor(message: string) {
    super(message, 'MESSAGE_ERROR')
    this.name = 'MessageError'
  }
}

/**
 * Error thrown when surface operation fails.
 */
export class SurfaceError extends AuxxError {
  constructor(message: string) {
    super(message, 'SURFACE_ERROR')
    this.name = 'SurfaceError'
  }
}

/**
 * Error thrown when server function execution fails.
 */
export class ServerFunctionError extends AuxxError {
  constructor(message: string) {
    super(message, 'SERVER_FUNCTION_ERROR')
    this.name = 'ServerFunctionError'
  }
}

/**
 * Error thrown when user connection is not available for server function.
 */
export class AuxxNoUserConnectionError extends AuxxError {
  constructor() {
    super('No user connection available', 'NO_USER_CONNECTION')
    this.name = 'AuxxNoUserConnectionError'
  }
}

/**
 * Error thrown when organization connection is not available for server function.
 */
export class AuxxNoOrganizationConnectionError extends AuxxError {
  constructor() {
    super('No organization connection available', 'NO_ORGANIZATION_CONNECTION')
    this.name = 'AuxxNoOrganizationConnectionError'
  }
}

/**
 * Error thrown when unexpected transport error occurs during server function call.
 */
export class AuxxUnexpectedTransportError extends AuxxError {
  constructor() {
    super('Unexpected transport error', 'UNEXPECTED_TRANSPORT_ERROR')
    this.name = 'AuxxUnexpectedTransportError'
  }
}

/**
 * Error thrown when a connection token is rejected by the external provider
 * (e.g. revoked, expired server-side, or invalid credentials).
 *
 * Platform catches this and auto-pauses the workflow, prompting the user
 * to reconnect their account.
 */
export class ConnectionExpiredError extends AuxxError {
  readonly scope: 'user' | 'organization'

  constructor(scope: 'user' | 'organization' = 'organization') {
    super(
      `${scope} connection expired or revoked. Please reconnect your account.`,
      'CONNECTION_EXPIRED'
    )
    this.name = 'ConnectionExpiredError'
    this.scope = scope
  }
}

// ============================================================
// Provider call errors (thrown by app tools/blocks when an
// external API call fails). Detection across the Lambda sandbox /
// module boundary uses `error.name` / `error.code`, NOT `instanceof`.
//
// NOTE: some names (NotFoundError, ConflictError, RateLimitError)
// collide with `@auxx/lib/errors` — those are the platform/tRPC
// classes in a DIFFERENT package. These are the app-facing
// `@auxx/sdk` contract; import them from `@auxx/sdk/server`.
// ============================================================

/**
 * Throw when the provider rejects the request because the connected account
 * lacks the required permission/scope (typically HTTP 403).
 *
 * Distinct from {@link ConnectionExpiredError}: the token is VALID, it just
 * can't perform this action. The platform does NOT mark the connection
 * expired — an admin re-authorizes the app with the missing scopes.
 */
export class InsufficientPermissionsError extends AuxxError {
  readonly scope: 'user' | 'organization'
  readonly requiredScopes?: string[]

  constructor(scope: 'user' | 'organization' = 'organization', requiredScopes?: string[]) {
    super(
      `The connected account lacks the required permission${
        requiredScopes?.length ? ` (${requiredScopes.join(', ')})` : ''
      }. An admin may need to re-authorize the app with additional scopes.`,
      'INSUFFICIENT_PERMISSIONS'
    )
    this.name = 'InsufficientPermissionsError'
    this.scope = scope
    this.requiredScopes = requiredScopes
  }
}

/**
 * Throw when the provider rate-limits the request (HTTP 429). Transient — the
 * platform surfaces `retryAfterSeconds` to the caller and does NOT mark the
 * connection expired. Not auto-retried: write operations may be non-idempotent,
 * so the caller decides whether to retry.
 */
export class RateLimitError extends AuxxError {
  readonly retryAfterSeconds?: number

  constructor(retryAfterSeconds?: number) {
    super(
      `Rate limited by the provider${retryAfterSeconds ? `; retry in ~${retryAfterSeconds}s` : ''}.`,
      'RATE_LIMIT'
    )
    this.name = 'RateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * Throw when the provider returns a server-side failure (HTTP 5xx) or the
 * request never completed (network/transport error, connection refused).
 * Transient and retryable; the connection is NOT marked expired.
 */
export class UpstreamServiceError extends AuxxError {
  readonly statusCode?: number

  constructor(message = 'The provider is temporarily unavailable.', statusCode?: number) {
    super(message, 'UPSTREAM_ERROR')
    this.name = 'UpstreamServiceError'
    this.statusCode = statusCode
  }
}

/**
 * Throw when the provider rejects the request as invalid (HTTP 400/422) — bad
 * arguments supplied by the caller. The message is surfaced to the agent so it
 * can correct its input and retry. Nothing is marked expired.
 *
 * For workflow-block field-level validation use {@link BlockValidationError}.
 */
export class InvalidInputError extends AuxxError {
  readonly fields?: Array<{ field: string; message: string }>

  constructor(message: string, fields?: Array<{ field: string; message: string }>) {
    super(message, 'INVALID_INPUT')
    this.name = 'InvalidInputError'
    this.fields = fields
  }
}

/**
 * Throw when the requested resource does not exist (HTTP 404). Distinct from
 * {@link ConnectionNotFoundError} (that's the connection itself) — this lets the
 * agent report "not found" cleanly instead of surfacing a tool failure.
 */
export class NotFoundError extends AuxxError {
  readonly resource?: string

  constructor(message = 'The requested resource was not found.', resource?: string) {
    super(message, 'RESOURCE_NOT_FOUND')
    this.name = 'NotFoundError'
    this.resource = resource
  }
}

/**
 * Throw when the request conflicts with the resource's current state (HTTP 409)
 * — e.g. an order already refunded, a duplicate create. Signals the caller it is
 * a state conflict, not something to blindly retry.
 */
export class ConflictError extends AuxxError {
  constructor(message = 'The request conflicts with the current state of the resource.') {
    super(message, 'CONFLICT')
    this.name = 'ConflictError'
  }
}

// ============================================================
// Workflow block execution errors (thrown inside execute())
// ============================================================

/**
 * Throw inside a workflow block's `execute()` function when a required input
 * field is missing or invalid.
 *
 * The platform captures per-field details and surfaces them in the workflow
 * editor — no generic "execution failed" toast is shown to the user.
 *
 * @example
 * ```typescript
 * if (!input.channelList) {
 *   throw new BlockValidationError([
 *     { field: 'channelList', message: 'Select a channel from the list.' },
 *   ])
 * }
 * ```
 *
 * NOTE: Detection across the Lambda sandbox / module boundary uses
 * `error.name === 'BlockValidationError'`, not `instanceof`.
 */
export class BlockValidationError extends AuxxError {
  readonly fields: Array<{ field: string; message: string }>

  constructor(fields: Array<{ field: string; message: string }> | string) {
    const normalized = typeof fields === 'string' ? [{ field: '', message: fields }] : fields
    super(normalized.map((f) => f.message).join('; '), 'BLOCK_VALIDATION_ERROR')
    this.name = 'BlockValidationError'
    this.fields = normalized
  }
}

/**
 * Throw inside a workflow block's `execute()` function for expected runtime
 * failures (API errors, rate limits, service unavailable, etc.).
 *
 * The platform shows the message in the result panel as a runtime error.
 * An optional `code` can be included for programmatic downstream handling.
 */
export class BlockRuntimeError extends AuxxError {
  constructor(message: string, code?: string) {
    super(message, code ?? 'BLOCK_RUNTIME_ERROR')
    this.name = 'BlockRuntimeError'
  }
}
