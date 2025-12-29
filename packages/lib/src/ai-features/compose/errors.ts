// packages/lib/src/ai-features/compose/errors.ts

export class AIComposeError extends Error {
  constructor(
    message: string,
    public code: string,
    public operation?: string,
    public details?: any
  ) {
    super(message)
    this.name = 'AIComposeError'
  }
}

export class ValidationError extends AIComposeError {
  constructor(message: string, operation?: string) {
    super(message, 'VALIDATION_ERROR', operation)
  }
}

export class ContextError extends AIComposeError {
  constructor(message: string, operation?: string) {
    super(message, 'CONTEXT_ERROR', operation)
  }
}

export class QuotaExceededError extends AIComposeError {
  constructor(message: string, operation?: string) {
    super(message, 'QUOTA_EXCEEDED', operation)
  }
}

export class ProviderError extends AIComposeError {
  constructor(message: string, operation?: string) {
    super(message, 'PROVIDER_ERROR', operation)
  }
}