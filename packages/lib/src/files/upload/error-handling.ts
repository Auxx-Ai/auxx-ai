// packages/lib/src/files/upload/error-handling.ts

import { SessionManager } from './session-manager'
import { ProgressPublisher } from './progress-publisher'
import { createScopedLogger } from '@auxx/logger'
type JsonInit = Omit<ResponseInit, 'headers'> & { headers?: HeadersInit }

function json(body: unknown, init: JsonInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  return new Response(JSON.stringify(body), { ...init, headers })
}

const logger = createScopedLogger('upload-error-handler')

/**
 * Categories of upload errors for better handling
 */
export enum UploadErrorType {
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  STORAGE = 'storage',
  PROCESSING = 'processing',
  NETWORK = 'network',
  QUOTA = 'quota',
  PERMISSION = 'permission',
  TIMEOUT = 'timeout',
  CORRUPTION = 'corruption',
  UNKNOWN = 'unknown',
}

/**
 * Structured error information for upload operations
 */
export interface UploadError {
  type: UploadErrorType
  message: string
  code?: string
  details?: Record<string, any>
  retryable: boolean
  userMessage: string
}

/**
 * Upload error handling utility
 */
export class UploadErrorHandler {
  /**
   * Categorize and handle errors during upload operations
   */
  static async handleUploadError(
    error: any,
    sessionId: string,
    operation: string,
    context?: Record<string, any>
  ): Promise<Response> {
    const uploadError = this.categorizeError(error)

    // Log the error with context
    logger.error(`Upload ${operation} failed`, {
      sessionId,
      operation,
      errorType: uploadError.type,
      message: uploadError.message,
      retryable: uploadError.retryable,
      context,
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Only update session status if it's not a temporary session (during creation)
    // Temp sessions start with 'temp-' and don't exist in Redis yet
    if (!sessionId.startsWith('temp-')) {
      try {
        await SessionManager.updateSession(sessionId, { status: 'failed' })
      } catch (updateError) {
        logger.warn('Failed to update session status', { sessionId, error: updateError })
      }
    }

    // Only publish failure notification for real sessions that clients are monitoring
    if (!sessionId.startsWith('temp-')) {
      await ProgressPublisher.publishFailed(sessionId, uploadError.userMessage, {
        errorType: uploadError.type,
        retryable: uploadError.retryable,
        operation,
      })
    }

    // Return appropriate HTTP response
    return json(
      {
        error: uploadError.userMessage,
        errorType: uploadError.type,
        retryable: uploadError.retryable,
        code: uploadError.code,
        details: uploadError.details,
      },
      {
        status: this.getHttpStatus(uploadError.type),
      }
    )
  }

  /**
   * Categorize error based on type and message
   */
  private static categorizeError(error: any): UploadError {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const lowerMessage = errorMessage.toLowerCase()

    // Storage-related errors
    if (
      lowerMessage.includes('storage') ||
      lowerMessage.includes('s3') ||
      lowerMessage.includes('bucket') ||
      lowerMessage.includes('key not found')
    ) {
      return {
        type: UploadErrorType.STORAGE,
        message: errorMessage,
        code: 'STORAGE_ERROR',
        retryable: true,
        userMessage: 'Storage service error. Please try again.',
      }
    }

    // Authentication/authorization errors
    if (
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('access denied') ||
      lowerMessage.includes('credentials') ||
      lowerMessage.includes('token')
    ) {
      return {
        type: UploadErrorType.AUTHENTICATION,
        message: errorMessage,
        code: 'AUTH_ERROR',
        retryable: false,
        userMessage: 'Authentication failed. Please reconnect your storage account.',
      }
    }

    // Validation errors
    if (
      lowerMessage.includes('validation') ||
      lowerMessage.includes('invalid') ||
      lowerMessage.includes('mime type') ||
      lowerMessage.includes('file size')
    ) {
      return {
        type: UploadErrorType.VALIDATION,
        message: errorMessage,
        code: 'VALIDATION_ERROR',
        retryable: false,
        userMessage: 'File validation failed. Please check file type and size.',
      }
    }

    // Quota/limit errors
    if (
      lowerMessage.includes('quota') ||
      lowerMessage.includes('limit') ||
      lowerMessage.includes('space') ||
      lowerMessage.includes('capacity')
    ) {
      return {
        type: UploadErrorType.QUOTA,
        message: errorMessage,
        code: 'QUOTA_ERROR',
        retryable: false,
        userMessage: 'Storage quota exceeded. Please free up space or upgrade your plan.',
      }
    }

    // Network/timeout errors
    if (
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('network') ||
      lowerMessage.includes('connection') ||
      lowerMessage.includes('econnreset')
    ) {
      return {
        type: UploadErrorType.NETWORK,
        message: errorMessage,
        code: 'NETWORK_ERROR',
        retryable: true,
        userMessage: 'Network error. Please check your connection and try again.',
      }
    }

    // File corruption errors
    if (
      lowerMessage.includes('checksum') ||
      lowerMessage.includes('corrupted') ||
      lowerMessage.includes('integrity') ||
      lowerMessage.includes('etag')
    ) {
      return {
        type: UploadErrorType.CORRUPTION,
        message: errorMessage,
        code: 'CORRUPTION_ERROR',
        retryable: true,
        userMessage: 'File corruption detected. Please try uploading again.',
      }
    }

    // Permission errors
    if (
      lowerMessage.includes('permission') ||
      lowerMessage.includes('forbidden') ||
      lowerMessage.includes('not allowed')
    ) {
      return {
        type: UploadErrorType.PERMISSION,
        message: errorMessage,
        code: 'PERMISSION_ERROR',
        retryable: false,
        userMessage: 'Permission denied. You may not have access to upload to this location.',
      }
    }

    // Default to unknown error
    return {
      type: UploadErrorType.UNKNOWN,
      message: errorMessage,
      code: 'UNKNOWN_ERROR',
      retryable: true,
      userMessage: 'An unexpected error occurred. Please try again.',
    }
  }

  /**
   * Get appropriate HTTP status code for error type
   */
  private static getHttpStatus(errorType: UploadErrorType): number {
    switch (errorType) {
      case UploadErrorType.VALIDATION:
        return 400
      case UploadErrorType.AUTHENTICATION:
        return 401
      case UploadErrorType.PERMISSION:
        return 403
      case UploadErrorType.QUOTA:
        return 413
      case UploadErrorType.TIMEOUT:
        return 408
      case UploadErrorType.STORAGE:
      case UploadErrorType.PROCESSING:
      case UploadErrorType.NETWORK:
      case UploadErrorType.CORRUPTION:
      case UploadErrorType.UNKNOWN:
        return 500
      default:
        return 500
    }
  }

  /**
   * Create standardized validation error response
   */
  static validationError(message: string, details?: Record<string, any>): Response {
    return json(
      {
        error: message,
        errorType: UploadErrorType.VALIDATION,
        retryable: false,
        code: 'VALIDATION_ERROR',
        details,
      },
      { status: 400 }
    )
  }

  /**
   * Create standardized session not found error
   */
  static sessionNotFound(sessionId: string): Response {
    logger.warn('Session not found', { sessionId })
    return json(
      {
        error: 'Upload session not found or expired',
        errorType: UploadErrorType.VALIDATION,
        retryable: false,
        code: 'SESSION_NOT_FOUND',
      },
      { status: 404 }
    )
  }

  /**
   * Create unauthorized error response
   */
  static unauthorized(reason?: string): Response {
    return json(
      {
        error: reason || 'Unauthorized access',
        errorType: UploadErrorType.AUTHENTICATION,
        retryable: false,
        code: 'UNAUTHORIZED',
      },
      { status: 401 }
    )
  }
}
