// packages/lib/src/ai/providers/openai/openai-tts-client.ts

import type OpenAI from 'openai'
import type { Logger } from '../../../logger'
import { TTSClient } from '../../clients/base/tts-client'
import type { ClientConfig, TTSParams, TTSResponse, UsageMetrics } from '../../clients/base/types'

/**
 * OpenAI specialized text-to-speech client
 */
export class OpenAITTSClient extends TTSClient {
  constructor(
    private apiClient: OpenAI,
    config: ClientConfig,
    logger?: Logger
  ) {
    super(config, 'OpenAI-TTS', logger)
  }

  async invoke(params: TTSParams): Promise<TTSResponse> {
    this.validateTTSParams(params)

    const startTime = this.getTimestamp()
    const sanitizedText = this.sanitizeText(params.text)

    this.logOperationStart('TTS invoke', {
      model: params.model,
      voice: params.voice,
      textLength: sanitizedText.length,
      format: params.format,
    })

    try {
      return await this.withRetryAndCircuitBreaker(
        async () => {
          const requestParams: any = {
            model: params.model,
            input: sanitizedText,
            voice: params.voice,
          }

          if (params.format) {
            requestParams.response_format = params.format
          }

          if (params.speed !== undefined) {
            requestParams.speed = params.speed
          }

          if (params.user) {
            requestParams.user = params.user
          }

          const response = await this.apiClient.audio.speech.create(requestParams)

          // Convert response to buffer
          const audioBuffer = Buffer.from(await response.arrayBuffer())
          const usage = this.calculateTTSUsage(sanitizedText)

          return {
            audio: audioBuffer,
            model: params.model,
            usage,
            metadata: {
              format: params.format || 'mp3',
              duration: this.estimateAudioDuration(sanitizedText, params.speed),
              voice: params.voice,
              textLength: sanitizedText.length,
            },
          }
        },
        {
          operation: 'tts_invoke',
          model: params.model,
        }
      )
    } catch (error) {
      this.handleApiError(error, 'invoke')
    } finally {
      this.logOperationSuccess('TTS invoke', this.getTimestamp() - startTime, {
        model: params.model,
      })
    }
  }

  /**
   * Generate speech for long text by splitting into chunks
   */
  async generateLongFormSpeech(params: TTSParams): Promise<TTSResponse> {
    const chunks = this.splitTextIntoChunks(params.text)

    if (chunks.length === 1) {
      return await this.invoke(params)
    }

    this.logger.info('Generating speech for long text', {
      originalLength: params.text.length,
      chunks: chunks.length,
    })

    const audioBuffers: Buffer[] = []
    const totalUsage: UsageMetrics = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    }

    for (const [index, chunk] of chunks.entries()) {
      this.logger.debug(`Processing chunk ${index + 1}/${chunks.length}`)

      const chunkResponse = await this.invoke({
        ...params,
        text: chunk,
      })

      audioBuffers.push(chunkResponse.audio)
      totalUsage.prompt_tokens += chunkResponse.usage.prompt_tokens
      totalUsage.total_tokens += chunkResponse.usage.total_tokens
    }

    const combinedAudio = this.combineAudioBuffers(audioBuffers)

    return {
      audio: combinedAudio,
      model: params.model,
      usage: totalUsage,
      metadata: {
        format: params.format || 'mp3',
        duration: this.estimateAudioDuration(params.text, params.speed),
        voice: params.voice,
        textLength: params.text.length,
        chunks: chunks.length,
      },
    }
  }

  /**
   * Get supported TTS models
   */
  getSupportedModels(): string[] {
    return ['tts-1', 'tts-1-hd']
  }

  /**
   * Get supported voices
   */
  protected getSupportedVoices(): string[] {
    return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
  }

  /**
   * Get supported audio formats
   */
  getSupportedFormats(): string[] {
    return ['mp3', 'opus', 'aac', 'flac']
  }

  /**
   * Get voice characteristics
   */
  getVoiceCharacteristics(): Record<string, { gender: string; description: string }> {
    return {
      alloy: { gender: 'neutral', description: 'Balanced, versatile voice' },
      echo: { gender: 'male', description: 'Deep, resonant voice' },
      fable: { gender: 'neutral', description: 'Warm, expressive voice' },
      onyx: { gender: 'male', description: 'Strong, authoritative voice' },
      nova: { gender: 'female', description: 'Clear, professional voice' },
      shimmer: { gender: 'female', description: 'Bright, engaging voice' },
    }
  }

  /**
   * Get model quality comparison
   */
  getModelQuality(): Record<string, { quality: string; speed: string; cost: string }> {
    return {
      'tts-1': { quality: 'standard', speed: 'fast', cost: 'lower' },
      'tts-1-hd': { quality: 'high', speed: 'slower', cost: 'higher' },
    }
  }

  /**
   * Get maximum text length for a single request
   */
  getMaxTextLength(): number {
    return 4096 // OpenAI TTS limit
  }

  /**
   * Estimate cost for TTS generation
   */
  estimateCost(text: string, model: string): number {
    // OpenAI TTS pricing (per 1K characters)
    const pricing: Record<string, number> = {
      'tts-1': 0.015,
      'tts-1-hd': 0.03,
    }

    const pricePerK = pricing[model] || pricing['tts-1']
    const characters = text.length
    const costPer1K = pricePerK

    return (characters / 1000) * costPer1K
  }

  /**
   * Override validation to include OpenAI-specific checks
   */
  protected validateTTSParams(params: TTSParams): void {
    super.validateTTSParams(params)

    if (!this.getSupportedModels().includes(params.model)) {
      throw new Error(`Unsupported TTS model: ${params.model}`)
    }

    if (!this.validateVoice(params.voice)) {
      throw new Error(
        `Unsupported voice: ${params.voice}. Supported voices: ${this.getSupportedVoices().join(', ')}`
      )
    }

    if (params.format && !this.getSupportedFormats().includes(params.format)) {
      throw new Error(
        `Unsupported format: ${params.format}. Supported formats: ${this.getSupportedFormats().join(', ')}`
      )
    }

    // Check text length
    if (params.text.length > this.getMaxTextLength()) {
      this.logger.warn('Text exceeds maximum length, will be split into chunks', {
        textLength: params.text.length,
        maxLength: this.getMaxTextLength(),
      })
    }

    // Validate speed range
    if (params.speed !== undefined) {
      if (params.speed < 0.25 || params.speed > 4.0) {
        throw new Error('Speed must be between 0.25 and 4.0')
      }
    }
  }

  /**
   * Enhanced text sanitization for TTS
   */
  protected sanitizeText(text: string): string {
    let sanitized = super.sanitizeText(text)

    // Additional TTS-specific cleaning
    // Remove or replace characters that might cause issues in speech synthesis
    sanitized = sanitized
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/\[.*?\]/g, '') // Remove bracketed content
      .replace(/\{.*?\}/g, '') // Remove braced content
      .replace(/\*+/g, '') // Remove asterisks (markdown)
      .replace(/_{2,}/g, ' ') // Replace multiple underscores with space
      .replace(/#{1,6}\s*/g, '') // Remove markdown headers
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]*`/g, '') // Remove inline code
      .replace(/\|/g, ',') // Replace pipes with commas
      .replace(/\s{2,}/g, ' ') // Normalize whitespace

    return sanitized.trim()
  }

  /**
   * Split text specifically for TTS (preserving natural speech breaks)
   */
  protected splitTextIntoChunks(text: string, maxChunkSize: number = 4000): string[] {
    if (text.length <= maxChunkSize) {
      return [text]
    }

    const chunks: string[] = []
    let currentChunk = ''

    // Split by paragraphs first (better for speech)
    const paragraphs = text.split(/\n\s*\n/)

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length <= maxChunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim())
          currentChunk = paragraph
        } else {
          // Paragraph is too long, split by sentences
          const sentences = paragraph.split(/(?<=[.!?])\s+/)
          let sentenceChunk = ''

          for (const sentence of sentences) {
            if (sentenceChunk.length + sentence.length <= maxChunkSize) {
              sentenceChunk += (sentenceChunk ? ' ' : '') + sentence
            } else {
              if (sentenceChunk) {
                chunks.push(sentenceChunk.trim())
                sentenceChunk = sentence
              } else {
                // Single sentence is too long, use word splitting
                chunks.push(...super.splitTextIntoChunks(sentence, maxChunkSize))
              }
            }
          }

          if (sentenceChunk) {
            currentChunk = sentenceChunk
          }
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim())
    }

    return chunks.filter((chunk) => chunk.length > 0)
  }
}
