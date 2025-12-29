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
