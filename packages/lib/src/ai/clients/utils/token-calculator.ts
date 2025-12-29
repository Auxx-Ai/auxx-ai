// packages/lib/src/ai/clients/utils/token-calculator.ts

import type { MultiModalContent, Message, Tool } from '../base/types'

/**
 * Token calculation utilities for different content types
 */
export class TokenCalculator {
  /**
   * Estimate tokens for text content using simple heuristics
   * More accurate implementations should use provider-specific tokenizers
   */
  static estimateTextTokens(text: string): number {
    // Simple approximation: ~4 characters per token for English
    // This is a rough estimate and should be replaced with actual tokenizer
    return Math.ceil(text.length / 4)
  }

  /**
   * Estimate tokens for multi-modal content
   */
  static estimateMultiModalTokens(content: MultiModalContent[]): number {
    let totalTokens = 0

    for (const item of content) {
      switch (item.type) {
        case 'text':
          totalTokens += this.estimateTextTokens(item.data)
          break
        case 'image':
          // Base image tokens + detail multiplier
          const baseTokens = 85
          const detailMultiplier = item.metadata?.detail === 'high' ? 9 : 1
          totalTokens += baseTokens * detailMultiplier
          break
        case 'audio':
          // Estimate based on duration (rough: 50 tokens per 10 seconds)
          const duration = item.metadata?.duration || 30
          totalTokens += Math.ceil(duration / 10) * 50
          break
      }
    }

    return totalTokens
  }

  /**
   * Estimate tokens for message array
   */
  static estimateMessagesTokens(messages: Message[]): number {
    let totalTokens = 0

    for (const message of messages) {
      // Role tokens (system/user/assistant)
      totalTokens += 4 // Approximate overhead per message

      if (typeof message.content === 'string') {
        totalTokens += this.estimateTextTokens(message.content)
      } else if (Array.isArray(message.content)) {
        totalTokens += this.estimateMultiModalTokens(message.content)
      }
    }

    return totalTokens
  }

  /**
   * Estimate tokens for tools schema
   */
  static estimateToolsTokens(tools: Tool[]): number {
    let totalTokens = 0

    for (const tool of tools) {
      // Function name and description
      totalTokens += this.estimateTextTokens(tool.function.name)
      if (tool.function.description) {
        totalTokens += this.estimateTextTokens(tool.function.description)
      }

      // Parameters schema (rough estimate)
      if (tool.function.parameters) {
        const parametersJson = JSON.stringify(tool.function.parameters)
        totalTokens += this.estimateTextTokens(parametersJson)
      }

      // Base overhead per tool
      totalTokens += 10
    }

    return totalTokens
  }

  /**
   * Get comprehensive token estimate for a complete request
   */
  static estimateRequestTokens(
    messages: Message[],
    tools?: Tool[],
    model?: string
  ): number {
    let totalTokens = 0

    // Messages
    totalTokens += this.estimateMessagesTokens(messages)

    // Tools
    if (tools && tools.length > 0) {
      totalTokens += this.estimateToolsTokens(tools)
    }

    // Model-specific overhead
    if (model) {
      if (model.includes('gpt-4')) {
        totalTokens += 50 // GPT-4 has higher overhead
      } else {
        totalTokens += 25 // Standard overhead
      }
    }

    return totalTokens
  }

  /**
   * Convert usage metrics to cost (requires cost per token data)
   */
  static calculateCost(
    usage: { prompt_tokens: number; completion_tokens: number },
    costPerToken?: { input: number; output: number }
  ): number {
    if (!costPerToken) return 0

    const inputCost = usage.prompt_tokens * costPerToken.input
    const outputCost = usage.completion_tokens * costPerToken.output

    return inputCost + outputCost
  }

  /**
   * Format token count for display
   */
  static formatTokenCount(tokens: number): string {
    if (tokens < 1000) {
      return `${tokens} tokens`
    } else if (tokens < 1000000) {
      return `${(tokens / 1000).toFixed(1)}K tokens`
    } else {
      return `${(tokens / 1000000).toFixed(1)}M tokens`
    }
  }

  /**
   * Check if token count is within model limits
   */
  static isWithinLimit(
    tokens: number,
    modelLimit: number,
    buffer: number = 100
  ): {
    withinLimit: boolean
    usage: number
    available: number
    buffer: number
  } {
    const available = modelLimit - buffer
    const withinLimit = tokens <= available

    return {
      withinLimit,
      usage: tokens,
      available,
      buffer,
    }
  }
}