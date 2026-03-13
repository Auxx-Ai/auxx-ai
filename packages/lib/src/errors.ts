export enum AuxxErrorCodes {
  UnexpectedError = 'UnexpectedError',
  RateLimitError = 'RateLimitError',
  UnauthorizedError = 'UnauthorizedError',
  ForbiddenError = 'ForbiddenError',
  BadRequestError = 'BadRequestError',
  NotFoundError = 'NotFoundError',
  ConflictError = 'ConflictError',
  UnprocessableEntityError = 'UnprocessableEntityError',
  UsageLimitError = 'UsageLimitError',
}

export enum RunErrorCodes {
  Unknown = 'unknown_error',
  DefaultProviderExceededQuota = 'default_provider_exceeded_quota_error',
  DefaultProviderInvalidModel = 'default_provider_invalid_model_error',
  DocumentConfigError = 'document_config_error',
  MissingProvider = 'missing_provider_error',
  ChainCompileError = 'chain_compile_error',
  AIRunError = 'ai_run_error',
  UnsupportedProviderResponseTypeError = 'unsupported_provider_response_type_error',
  AIProviderConfigError = 'ai_provider_config_error',
  InvalidResponseFormatError = 'invalid_response_format_error',
}
// NOTE: If you add a new error code, please add it to the pg enum in models/runErrors.ts

export type RunErrorDetails<C extends RunErrorCodes> = C extends RunErrorCodes.ChainCompileError
  ? { compileCode: string; message: string }
  : never

export enum ApiErrorCodes {
  HTTPException = 'http_exception',
  InternalServerError = 'internal_server_error',
}

export type DbErrorRef = { entityUuid: string; entityType: string }

export type ApiErrorJsonResponse = {
  name: string
  message: string
  details: object
  errorCode: ApiResponseCode
  dbErrorRef?: DbErrorRef
}
export type ApiResponseCode = RunErrorCodes | ApiErrorCodes | AuxxErrorCodes

export type AuxxErrorDetails = {
  [key: string]: string[] | string | undefined
  [key: number]: string[] | string | undefined
  [key: symbol]: string[] | string | undefined
}

export class AuxxError extends Error {
  statusCode: number = 500
  name: string = AuxxErrorCodes.UnexpectedError
  headers: Record<string, string> = {}

  public details: AuxxErrorDetails

  constructor(message: string, details: AuxxErrorDetails = {}) {
    super(message)
    this.details = details
    this.name = this.constructor.name
  }
}

export class ConflictError extends AuxxError {
  public statusCode = 409
  public name = AuxxErrorCodes.ConflictError
}

export class UnprocessableEntityError extends AuxxError {
  public statusCode = 422
  public name = AuxxErrorCodes.UnprocessableEntityError

  constructor(message: string, details: AuxxErrorDetails = {}) {
    super(message, details)
  }
}

export class NotFoundError extends AuxxError {
  public statusCode = 404
  public name = AuxxErrorCodes.NotFoundError
}

export class BadRequestError extends AuxxError {
  public statusCode = 400
  public name = AuxxErrorCodes.BadRequestError
}

export class ForbiddenError extends AuxxError {
  public statusCode = 403
  public name = AuxxErrorCodes.ForbiddenError
}

export class UnauthorizedError extends AuxxError {
  public statusCode = 401
  public name = AuxxErrorCodes.UnauthorizedError
}
export class RateLimitError extends AuxxError {
  public statusCode = 429
  public name = AuxxErrorCodes.RateLimitError

  constructor(
    message: string,
    retryAfter?: number,
    limit?: number,
    remaining?: number,
    resetTime?: number
  ) {
    super(message)

    this.headers = {}
    if (retryAfter !== undefined) {
      this.headers['Retry-After'] = retryAfter.toString()
    }
    if (limit !== undefined) {
      this.headers['X-RateLimit-Limit'] = limit.toString()
    }
    if (remaining !== undefined) {
      this.headers['X-RateLimit-Remaining'] = remaining.toString()
    }
    if (resetTime !== undefined) {
      this.headers['X-RateLimit-Reset'] = resetTime.toString()
    }
  }
}

export class UsageLimitError extends AuxxError {
  public statusCode = 403
  public name = AuxxErrorCodes.UsageLimitError
  public metric: string
  public current: number
  public limit: number

  constructor(params: {
    metric: string
    current: number
    limit: number
    message?: string
  }) {
    super(
      params.message ??
        `You have reached your plan limit for ${params.metric}. ` +
          `Usage: ${params.current}/${params.limit}. ` +
          `Upgrade your plan to continue.`
    )
    this.metric = params.metric
    this.current = params.current
    this.limit = params.limit
    this.details = {
      metric: params.metric,
      current: String(params.current),
      limit: String(params.limit),
      upgradeRequired: 'true',
    }
  }
}

export const databaseErrorCodes = {
  foreignKeyViolation: '23503',
  uniqueViolation: '23505',
  lockNotAvailable: '55P03',
}
