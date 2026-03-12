// packages/lib/src/email/inbound/errors.ts

/**
 * PermanentProcessingError signals a non-retryable inbound email failure.
 * The SQS poller should delete the message immediately instead of letting it retry.
 */
export class PermanentProcessingError extends Error {
  constructor(
    message: string,
    public readonly reason: string
  ) {
    super(message)
    this.name = 'PermanentProcessingError'
  }
}
