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
