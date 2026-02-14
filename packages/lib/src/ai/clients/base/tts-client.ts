// packages/lib/src/ai/clients/base/tts-client.ts

import { BaseSpecializedClient } from './base-specialized-client'
import type { TTSParams, TTSResponse } from './types'

/**
 * Abstract base class for text-to-speech clients
 */
export abstract class TTSClient extends BaseSpecializedClient {
  // ===== ABSTRACT METHODS =====

  /**
   * Convert text to speech
   */
  abstract invoke(params: TTSParams): Promise<TTSResponse>

  // ===== IMPLEMENTED METHODS =====

  /**
   * Validate TTS parameters
   */
  protected validateTTSParams(params: TTSParams): void {
    this.validateRequiredParams(params, ['text', 'model', 'voice'])

    if (typeof params.text !== 'string' || params.text.trim().length === 0) {
      throw new Error('Text must be a non-empty string')
    }

    if (params.text.length > 4096) {
      throw new Error('Text is too long (max 4096 characters)')
    }

    if (params.format && !['mp3', 'wav', 'flac', 'opus'].includes(params.format)) {
      throw new Error('Format must be one of: mp3, wav, flac, opus')
    }

    if (params.speed !== undefined) {
      if (typeof params.speed !== 'number' || params.speed < 0.25 || params.speed > 4.0) {
        throw new Error('Speed must be a number between 0.25 and 4.0')
      }
    }
  }

  /**
   * Estimate audio duration based on text length and speech rate
   */
  protected estimateAudioDuration(text: string, speed: number = 1.0): number {
    // Average speech rate: ~150 words per minute
    // Average word length: ~5 characters
    const wordsPerMinute = 150 * speed
    const charactersPerMinute = wordsPerMinute * 5
    const charactersPerSecond = charactersPerMinute / 60

    // Remove whitespace and special characters for better estimation
    const effectiveText = text.replace(/[^\w]/g, '')

    return Math.max(1, Math.ceil(effectiveText.length / charactersPerSecond))
  }

  /**
   * Get supported voices for a provider (override in implementations)
   */
  protected getSupportedVoices(): string[] {
    return [] // Base implementation returns empty array
  }

  /**
   * Validate voice selection
   */
  protected validateVoice(voice: string): boolean {
    const supportedVoices = this.getSupportedVoices()

    if (supportedVoices.length === 0) {
      // If no supported voices defined, assume all are valid
      return true
    }

    return supportedVoices.includes(voice)
  }

  /**
   * Get audio format MIME type
   */
  protected getAudioMimeType(format: string = 'mp3'): string {
    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      flac: 'audio/flac',
      opus: 'audio/ogg',
    }

    return mimeTypes[format] || 'audio/mpeg'
  }

  /**
   * Validate and sanitize text for TTS
   */
  protected sanitizeText(text: string): string {
    // Remove excessive whitespace
    let sanitized = text.replace(/\s+/g, ' ').trim()

    // Remove or replace problematic characters
    sanitized = sanitized.replace(/[^\w\s.,!?;:()\-'"]/g, '')

    // Ensure text isn't too long
    if (sanitized.length > 4096) {
      sanitized = sanitized.substring(0, 4096)
      // Try to end at a sentence boundary
      const lastSentenceEnd = Math.max(
        sanitized.lastIndexOf('.'),
        sanitized.lastIndexOf('!'),
        sanitized.lastIndexOf('?')
      )

      if (lastSentenceEnd > 3000) {
        sanitized = sanitized.substring(0, lastSentenceEnd + 1)
      }
    }

    return sanitized
  }

  /**
   * Split long text into chunks for processing
   */
  protected splitTextIntoChunks(text: string, maxChunkSize: number = 4000): string[] {
    if (text.length <= maxChunkSize) {
      return [text]
    }

    const chunks: string[] = []
    let currentChunk = ''

    // Split by sentences first
    const sentences = text.split(/(?<=[.!?])\s+/)

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length <= maxChunkSize) {
        currentChunk += (currentChunk ? ' ' : '') + sentence
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim())
          currentChunk = sentence
        } else {
          // Single sentence is too long, split by words
          const words = sentence.split(/\s+/)
          let wordChunk = ''

          for (const word of words) {
            if (wordChunk.length + word.length <= maxChunkSize) {
              wordChunk += (wordChunk ? ' ' : '') + word
            } else {
              if (wordChunk) {
                chunks.push(wordChunk.trim())
                wordChunk = word
              } else {
                // Single word is too long, truncate
                chunks.push(word.substring(0, maxChunkSize))
              }
            }
          }

          if (wordChunk) {
            currentChunk = wordChunk
          }
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim())
    }

    return chunks.filter((chunk) => chunk.length > 0)
  }

  /**
   * Combine multiple audio buffers into one
   */
  protected combineAudioBuffers(buffers: Buffer[]): Buffer {
    if (buffers.length === 0) {
      return Buffer.alloc(0)
    }

    if (buffers.length === 1) {
      return buffers[0]
    }

    return Buffer.concat(buffers)
  }

  /**
   * Calculate estimated usage tokens for TTS
   */
  protected calculateTTSUsage(text: string): {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  } {
    // TTS typically charges based on characters or tokens in input text
    const inputTokens = Math.ceil(text.length / 4) // Rough approximation

    return {
      prompt_tokens: inputTokens,
      completion_tokens: 0, // TTS doesn't produce text tokens
      total_tokens: inputTokens,
    }
  }
}
