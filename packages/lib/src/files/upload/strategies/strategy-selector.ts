// packages/lib/src/files/upload/strategies/strategy-selector.ts

import type {
  UploadRequest,
  UploadStrategy,
  UploadPreferences,
  UploadStrategyHandler,
} from '../enhanced-types'
import type { ProviderId, StorageCapabilities } from '../../adapters/base-adapter'
import { DirectUploadStrategy } from './direct-upload'
import { MultipartUploadStrategy } from './multipart-upload'
import { PresignedUploadStrategy } from './presigned-upload'
import type { StorageManager } from '../../storage/storage-manager'
import { createScopedLogger } from '@auxx/logger'

import { formatBytes } from '@auxx/lib/utils'
const logger = createScopedLogger('upload-strategy-selector')

/**
 * Upload strategy selector that chooses the optimal strategy
 * based on file size, provider capabilities, and preferences
 */
export class UploadStrategySelector {
  private readonly strategies: Map<UploadStrategy, UploadStrategyHandler>
  private readonly storageManager: StorageManager

  constructor(storageManager: StorageManager) {
    this.storageManager = storageManager
    this.strategies = new Map<UploadStrategy, UploadStrategyHandler>([
      ['direct', new DirectUploadStrategy(storageManager)],
      ['multipart', new MultipartUploadStrategy(storageManager)],
      ['presigned', new PresignedUploadStrategy(storageManager)],
      // Note: 'chunked' strategy would be added here when implemented
    ])
  }

  /**
   * Select the optimal upload strategy for a request
   */
  async selectStrategy(
    request: UploadRequest,
    capabilities: StorageCapabilities,
    preferences?: UploadPreferences
  ): Promise<UploadStrategy> {
    // If strategy is explicitly specified and not 'auto', use it
    if (request.strategy && request.strategy !== 'auto') {
      const strategy = this.strategies.get(request.strategy)
      if (!strategy) {
        logger.warn(`Requested strategy ${request.strategy} not available, falling back to auto`, {
          filename: request.filename,
          provider: request.provider,
        })
        return this.autoSelectStrategy(request, capabilities, preferences)
      }

      if (!strategy.canHandle(request)) {
        logger.warn(
          `Requested strategy ${request.strategy} cannot handle request, falling back to auto`,
          {
            filename: request.filename,
            fileSize: request.size,
            provider: request.provider,
          }
        )
        return this.autoSelectStrategy(request, capabilities, preferences)
      }

      return request.strategy
    }

    // Auto-select optimal strategy
    return this.autoSelectStrategy(request, capabilities, preferences)
  }

  /**
   * Auto-select the optimal strategy based on various factors
   */
  private async autoSelectStrategy(
    request: UploadRequest,
    capabilities: StorageCapabilities,
    preferences?: UploadPreferences
  ): Promise<UploadStrategy> {
    const fileSize = request.size || this.getFileSizeFromContent(request.content, request.size)
    const provider = request.provider!

    logger.debug('Auto-selecting upload strategy', {
      filename: request.filename,
      fileSize,
      provider,
      capabilities: {
        presignUpload: capabilities.presignUpload,
        serverSideDownload: capabilities.serverSideDownload,
      },
      preferences: preferences?.defaultStrategy,
    })

    // Strategy selection logic based on file size and capabilities
    const rules = this.getStrategySelectionRules(capabilities, preferences)

    for (const rule of rules) {
      if (rule.condition(fileSize, provider, capabilities)) {
        const strategy = this.strategies.get(rule.strategy)
        if (strategy && strategy.canHandle(request)) {
          logger.info(`Selected ${rule.strategy} strategy for upload`, {
            filename: request.filename,
            fileSize,
            reason: rule.reason,
          })
          return rule.strategy
        }
      }
    }

    // Default fallback to direct upload
    logger.info('Falling back to direct upload strategy', {
      filename: request.filename,
      fileSize,
    })
    return 'direct'
  }

  /**
   * Get strategy selection rules in priority order
   */
  private getStrategySelectionRules(
    capabilities: StorageCapabilities,
    preferences?: UploadPreferences
  ): Array<{
    strategy: UploadStrategy
    condition: (fileSize: number, provider: ProviderId, caps: StorageCapabilities) => boolean
    reason: string
  }> {
    const rules = []

    // Rule 1: Use preferred strategy if specified and appropriate
    if (preferences?.defaultStrategy && preferences.defaultStrategy !== 'auto') {
      rules.push({
        strategy: preferences.defaultStrategy,
        condition: (fileSize: number) => {
          // Check if preferred strategy is appropriate for file size
          if (preferences.defaultStrategy === 'multipart' && fileSize >= 50 * 1024 * 1024)
            return true
          if (preferences.defaultStrategy === 'direct' && fileSize <= 50 * 1024 * 1024) return true
          if (preferences.defaultStrategy === 'presigned') return true
          return false
        },
        reason: 'User preference',
      })
    }

    // Rule 2: Large files (>100MB) always use multipart if available
    rules.push({
      strategy: 'multipart' as UploadStrategy,
      condition: (fileSize: number, provider: ProviderId, caps: StorageCapabilities) =>
        fileSize > 100 * 1024 * 1024 && caps.presignUpload,
      reason: 'Large file size (>100MB)',
    })

    // Rule 3: Medium files (50-100MB) prefer multipart for better reliability
    rules.push({
      strategy: 'multipart' as UploadStrategy,
      condition: (fileSize: number, provider: ProviderId, caps: StorageCapabilities) =>
        fileSize >= 50 * 1024 * 1024 && fileSize <= 100 * 1024 * 1024 && caps.presignUpload,
      reason: 'Medium file size (50-100MB)',
    })

    // Rule 4: Small files (<50MB) use direct upload
    rules.push({
      strategy: 'direct' as UploadStrategy,
      condition: (fileSize: number) => fileSize < 50 * 1024 * 1024,
      reason: 'Small file size (<50MB)',
    })

    // Rule 5: Fallback to direct for any remaining cases
    rules.push({
      strategy: 'direct' as UploadStrategy,
      condition: () => true,
      reason: 'Default fallback',
    })

    return rules
  }

  /**
   * Get strategy handler for a specific strategy
   */
  getStrategy(strategy: UploadStrategy): UploadStrategyHandler | undefined {
    return this.strategies.get(strategy)
  }

  /**
   * Get all available strategies
   */
  getAvailableStrategies(): UploadStrategy[] {
    return Array.from(this.strategies.keys())
  }

  /**
   * Check if a strategy is available
   */
  isStrategyAvailable(strategy: UploadStrategy): boolean {
    return this.strategies.has(strategy)
  }

  /**
   * Register a new strategy
   */
  registerStrategy(strategy: UploadStrategy, handler: UploadStrategyHandler): void {
    this.strategies.set(strategy, handler)
    logger.info(`Registered upload strategy: ${strategy}`)
  }

  /**
   * Get file size from content
   */
  private getFileSizeFromContent(
    content: File | Buffer | NodeJS.ReadableStream,
    providedSize?: number
  ): number {
    // Feature-detect File type (browser environment)
    if (typeof (global as any).File !== 'undefined' && content instanceof (global as any).File) {
      return (content as any).size
    }
    if (Buffer.isBuffer(content)) {
      return content.length
    }
    if (providedSize != null) {
      return providedSize
    }
    // For streams without provided size, this is a validation error
    // Streams must have size specified for proper validation
    throw new Error('Size is required for stream uploads in Node.js environment')
  }

  /**
   * Analyze optimal strategy for a request without executing it
   */
  async analyzeOptimalStrategy(
    request: UploadRequest,
    capabilities?: StorageCapabilities,
    preferences?: UploadPreferences
  ): Promise<{
    recommendedStrategy: UploadStrategy
    reason: string
    alternatives: Array<{ strategy: UploadStrategy; reason: string }>
    warnings?: string[]
  }> {
    const fileSize = request.size || this.getFileSizeFromContent(request.content, request.size)
    const caps =
      capabilities || (await this.storageManager.getProviderCapabilities(request.provider!))

    const recommendedStrategy = await this.selectStrategy(request, caps, preferences)

    // Analyze alternatives
    const alternatives: Array<{ strategy: UploadStrategy; reason: string }> = []
    const warnings: string[] = []

    for (const [strategy, handler] of this.strategies) {
      if (strategy !== recommendedStrategy && handler.canHandle(request)) {
        let reason = ''

        if (strategy === 'direct') {
          reason = 'Simple upload for smaller files'
        } else if (strategy === 'multipart') {
          reason = 'Better for large files and resume capability'
        } else if (strategy === 'presigned') {
          reason = 'Client-side upload reduces server load'
        }

        alternatives.push({ strategy, reason })
      }
    }

    // Generate warnings
    if (fileSize > 100 * 1024 * 1024 && recommendedStrategy === 'direct') {
      warnings.push('Large file using direct upload may be slow and not resumable')
    }

    if (fileSize < 10 * 1024 * 1024 && recommendedStrategy === 'multipart') {
      warnings.push('Small file using multipart upload may have overhead')
    }

    return {
      recommendedStrategy,
      reason: this.getStrategyReason(recommendedStrategy, fileSize, caps),
      alternatives,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  /**
   * Get human-readable reason for strategy selection
   */
  private getStrategyReason(
    strategy: UploadStrategy,
    fileSize: number,
    capabilities: StorageCapabilities
  ): string {
    switch (strategy) {
      case 'direct':
        return `Direct upload suitable for ${formatBytes(fileSize)} file`
      case 'multipart':
        return `Multipart upload recommended for ${formatBytes(fileSize)} file for better reliability`
      case 'presigned':
        return 'Presigned upload for client-side transfer'
      default:
        return 'Selected based on file characteristics and provider capabilities'
    }
  }
}
