// apps/worker/src/inbound-email/sqs-poller.ts

import { createScopedLogger } from '@auxx/logger'
import {
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs'
import { processInboundEmailQueueMessage } from './process-sqs-message'

const logger = createScopedLogger('inbound-email-sqs-poller')

/**
 * inboundEmailQueueRegion is the AWS region used for inbound queue polling.
 */
const inboundEmailQueueRegion =
  process.env.INBOUND_EMAIL_QUEUE_REGION || process.env.AWS_REGION || 'us-west-1'

/**
 * sqsClient is the shared SQS client for inbound queue polling.
 */
const sqsClient = new SQSClient({
  region: inboundEmailQueueRegion,
})

/**
 * sleep pauses the poll loop after recoverable errors.
 */
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

/**
 * isInboundEmailPollingEnabled checks whether the poller should start.
 */
export function isInboundEmailPollingEnabled(): boolean {
  return process.env.INBOUND_EMAIL_ENABLED === 'true' && !!process.env.INBOUND_EMAIL_QUEUE_URL
}

/**
 * InboundEmailPoller exposes lifecycle controls for the background poll loop.
 */
export interface InboundEmailPoller {
  stop(): Promise<void>
}

/**
 * SqsInboundEmailPoller manages the long-running SQS receive loop.
 */
class SqsInboundEmailPoller implements InboundEmailPoller {
  /**
   * queueUrl is the queue URL to poll.
   */
  private queueUrl: string

  /**
   * isStopping tracks graceful shutdown state.
   */
  private isStopping = false

  /**
   * loopPromise is the active poll-loop promise.
   */
  private loopPromise: Promise<void> | null = null

  constructor(queueUrl: string) {
    this.queueUrl = queueUrl
  }

  /**
   * start begins the long-poll loop.
   */
  start(): void {
    this.loopPromise = this.run()
  }

  /**
   * stop signals the loop to stop and waits for completion.
   */
  async stop(): Promise<void> {
    this.isStopping = true
    await this.loopPromise
  }

  /**
   * deleteMessage removes a successfully processed SQS message.
   */
  private async deleteMessage(message: Message): Promise<void> {
    if (!message.ReceiptHandle) return

    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      })
    )
  }

  /**
   * processMessage processes one received SQS message and deletes it on success.
   */
  private async processMessage(message: Message): Promise<void> {
    const payload = await processInboundEmailQueueMessage(message)
    await this.deleteMessage(message)

    logger.info('Processed inbound email SQS message', {
      sesMessageId: payload.sesMessageId,
      recipients: payload.recipients,
    })
  }

  /**
   * run executes the long-poll loop until shutdown.
   */
  private async run(): Promise<void> {
    logger.info('Starting inbound email SQS poller', {
      queueUrl: this.queueUrl,
      region: inboundEmailQueueRegion,
    })

    while (!this.isStopping) {
      try {
        const response = await sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 5,
            WaitTimeSeconds: 20,
            VisibilityTimeout: 300,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          })
        )

        const messages = response.Messages ?? []

        for (const message of messages) {
          if (this.isStopping) break

          try {
            await this.processMessage(message)
          } catch (error) {
            logger.error('Failed to process inbound email SQS message', {
              error: error instanceof Error ? error.message : String(error),
              messageId: message.MessageId,
              receiveCount: message.Attributes?.ApproximateReceiveCount,
            })
          }
        }
      } catch (error) {
        logger.error('Inbound email SQS poller receive failed', {
          error: error instanceof Error ? error.message : String(error),
        })

        if (!this.isStopping) {
          await sleep(5000)
        }
      }
    }

    logger.info('Stopped inbound email SQS poller', {
      queueUrl: this.queueUrl,
    })
  }
}

/**
 * startInboundEmailPoller starts the inbound poller when the feature is enabled.
 */
export function startInboundEmailPoller(): InboundEmailPoller | null {
  const queueUrl = process.env.INBOUND_EMAIL_QUEUE_URL
  if (!isInboundEmailPollingEnabled() || !queueUrl) {
    logger.info('Inbound email SQS poller disabled', {
      enabled: process.env.INBOUND_EMAIL_ENABLED,
      hasQueueUrl: !!queueUrl,
    })
    return null
  }

  const poller = new SqsInboundEmailPoller(queueUrl)
  poller.start()
  return poller
}
