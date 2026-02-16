// apps/web/src/utils/error.ts

export type ApiErrorType = { type: string; message?: string; code: number }

export type ActionError<E extends object = Record<string, unknown>> = { error: string } & E

/** Checks if a value is an action error response (has an `error` string property) */
export function isActionError(error: any): error is ActionError {
  return error && typeof error === 'object' && 'error' in error && error.error
}

// ---------------------------------------------------------------------------
// Error classifiers – useful for tRPC middleware / error handling integration
// ---------------------------------------------------------------------------

/** Gmail returned 'insufficientPermissions' */
export function isGmailInsufficientPermissionsError(error: unknown): boolean {
  return (error as any)?.errors?.[0]?.reason === 'insufficientPermissions'
}

/** Gmail returned 'rateLimitExceeded' */
export function isGmailRateLimitExceededError(error: unknown): boolean {
  return (error as any)?.errors?.[0]?.reason === 'rateLimitExceeded'
}

/** Gmail returned 'quotaExceeded' */
export function isGmailQuotaExceededError(error: unknown): boolean {
  return (error as any)?.errors?.[0]?.reason === 'quotaExceeded'
}

/** OpenAI API key is incorrect */
export function isIncorrectOpenAIAPIKeyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Incorrect API key provided')
}

/** OpenAI model does not exist or no access */
export function isInvalidOpenAIModelError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('does not exist or you do not have access to it')
  )
}

/** OpenAI API key has been deactivated */
export function isOpenAIAPIKeyDeactivatedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('this API key has been deactivated')
}

/** Anthropic credit balance too low */
export function isAnthropicInsufficientBalanceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('Your credit balance is too low to access the Anthropic API')
  )
}

/** OpenAI quota exceeded (user's own API quota) */
export function isOpenAIRetryError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('You exceeded your current quota')
}

/** AWS ThrottlingException */
export function isAWSThrottlingError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.name === 'ThrottlingException' &&
    (error.message?.includes('Too many requests') ||
      error.message?.includes('please wait before trying again'))
  )
}

/** AWS ServiceUnavailableException */
export function isServiceUnavailableError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'ServiceUnavailableException'
}

/** Checks for common API errors and returns a typed error object if matched */
export function checkCommonErrors(error: unknown, url: string): ApiErrorType | null {
  if (isGmailInsufficientPermissionsError(error)) {
    console.warn(`Gmail insufficient permissions error for url: ${url}`)
    return {
      type: 'Gmail Insufficient Permissions',
      message:
        'You must grant all Gmail permissions to use the app. Please log out and log in again to grant permissions.',
      code: 403,
    }
  }

  if (isGmailRateLimitExceededError(error)) {
    console.warn(`Gmail rate limit exceeded for url: ${url}`)
    const errorMessage = (error as any)?.errors?.[0]?.message ?? 'Unknown error'
    return { type: 'Gmail Rate Limit Exceeded', message: `Gmail error: ${errorMessage}`, code: 429 }
  }

  if (isGmailQuotaExceededError(error)) {
    console.warn(`Gmail quota exceeded for url: ${url}`)
    return {
      type: 'Gmail Quota Exceeded',
      message: 'You have exceeded the Gmail quota. Please try again later.',
      code: 429,
    }
  }

  return null
}
