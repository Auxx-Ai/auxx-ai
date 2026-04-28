// packages/lib/src/ai/providers/openai/openai-speech2text-client.ts

import type OpenAI from 'openai'
import type { Logger } from '../../../logger'
import { Speech2TextClient } from '../../clients/base/speech2text-client'
import type {
  ClientConfig,
  TranscribeParams,
  TranscribeResponse,
  TranscriptSegment,
  UsageMetrics,
} from '../../clients/base/types'

/**
 * OpenAI specialized speech-to-text client
 */
export class OpenAISpeech2TextClient extends Speech2TextClient {
  constructor(
    private apiClient: OpenAI,
    config: ClientConfig,
    logger?: Logger
  ) {
    super(config, 'OpenAI-Speech2Text', logger)
  }

  async invoke(params: TranscribeParams): Promise<TranscribeResponse> {
    this.validateTranscribeParams(params)
    this.validateAudioFile(params.audio)

    const startTime = this.getTimestamp()

    this.logOperationStart('Speech2Text invoke', {
      model: params.model,
      audioType: typeof params.audio,
      format: params.format,
      language: params.language,
      mimeType: params.mimeType,
    })

    try {
      return await this.withRetryAndCircuitBreaker(
        async () => {
          const requestParams: any = {
            model: params.model,
            file: this.prepareAudioFile(params.audio, params.mimeType, params.filename),
          }

          if (params.language) {
            requestParams.language = params.language
          }

          if (params.temperature !== undefined) {
            requestParams.temperature = params.temperature
          }

          if (params.response_format) {
            requestParams.response_format = params.response_format
          } else if (params.format) {
            requestParams.response_format = params.format
          }

          if (params.user) {
            requestParams.user = params.user
          }

          const response = await this.apiClient.audio.transcriptions.create(requestParams)

          return this.processTranscriptionResponse(response, params)
        },
        {
          operation: 'speech2text_invoke',
          model: params.model,
        }
      )
    } catch (error) {
      this.handleApiError(error, 'invoke')
    } finally {
      this.logOperationSuccess('Speech2Text invoke', this.getTimestamp() - startTime, {
        model: params.model,
      })
    }
  }

  private prepareAudioFile(audio: Buffer | string, mimeType?: string, filename?: string): any {
    if (Buffer.isBuffer(audio)) {
      // Whisper detects format via the filename extension on multipart uploads,
      // so we must derive both type and extension from the caller's mimeType
      // rather than hardcoding mp3.
      const resolvedType = mimeType || 'audio/webm'
      const resolvedName = filename || `audio.${this.extensionForMime(resolvedType)}`
      return new File([audio], resolvedName, { type: resolvedType })
    } else {
      // Assume it's a file path - this would need proper file handling in real implementation
      throw new Error('File path audio input not supported in this implementation')
    }
  }

  /** Map a MIME type to one of the file extensions whisper-1 accepts. */
  private extensionForMime(mimeType: string): string {
    const lower = mimeType.toLowerCase()
    if (lower.includes('webm')) return 'webm'
    if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) return 'm4a'
    if (lower.includes('ogg') || lower.includes('opus')) return 'ogg'
    if (lower.includes('wav')) return 'wav'
    if (lower.includes('flac')) return 'flac'
    if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3'
    return 'webm'
  }

  private processTranscriptionResponse(
    response: any,
    params: TranscribeParams
  ): TranscribeResponse {
    const format = params.response_format || params.format || 'json'

    if (format === 'json' || format === 'verbose_json') {
      return {
        text: response.text,
        language: response.language,
        segments: this.processSegments(response.segments),
        usage: this.calculateUsage(response),
      }
    } else if (format === 'srt') {
      return {
        text: response, // SRT format returned as string
        usage: this.calculateUsage(response),
      }
    } else if (format === 'vtt') {
      return {
        text: response, // VTT format returned as string
        usage: this.calculateUsage(response),
      }
    } else {
      return {
        text: response, // Text format
        usage: this.calculateUsage(response),
      }
    }
  }

  private processSegments(segments?: any[]): TranscriptSegment[] | undefined {
    if (!segments) return undefined

    return segments.map((segment, index) => ({
      id: segment.id || index,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      confidence: segment.confidence,
    }))
  }

  private calculateUsage(response: any): UsageMetrics {
    // OpenAI audio APIs typically charge per minute of audio
    // This is an estimation - actual usage would come from response headers or separate API call
    const duration = this.estimateAudioDurationFromResponse(response)
    const audioMinutes = Math.ceil(duration / 60)

    return {
      prompt_tokens: audioMinutes, // Using minutes as "tokens" for audio
      completion_tokens: 0,
      total_tokens: audioMinutes,
    }
  }

  private estimateAudioDurationFromResponse(response: any): number {
    // Try to extract duration from segments or estimate from text length
    if (response.segments && response.segments.length > 0) {
      const lastSegment = response.segments[response.segments.length - 1]
      return lastSegment.end || 30 // Default to 30 seconds if no timing info
    }

    // Estimate based on text length (rough: 150 words per minute, 5 chars per word)
    const textLength = response.text?.length || 0
    const estimatedWords = textLength / 5
    const estimatedMinutes = estimatedWords / 150

    return Math.max(estimatedMinutes * 60, 1) // At least 1 second
  }

  /**
   * Get supported audio formats
   */
  getSupportedFormats(): string[] {
    return ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm']
  }

  /**
   * Get supported languages (ISO 639-1 codes)
   */
  getSupportedLanguages(): string[] {
    return [
      'af',
      'ar',
      'hy',
      'az',
      'be',
      'bs',
      'bg',
      'ca',
      'zh',
      'hr',
      'cs',
      'da',
      'nl',
      'en',
      'et',
      'fi',
      'fr',
      'gl',
      'de',
      'el',
      'he',
      'hi',
      'hu',
      'is',
      'id',
      'it',
      'ja',
      'kn',
      'kk',
      'ko',
      'lv',
      'lt',
      'mk',
      'ms',
      'mr',
      'mi',
      'ne',
      'no',
      'fa',
      'pl',
      'pt',
      'ro',
      'ru',
      'sr',
      'sk',
      'sl',
      'es',
      'sw',
      'sv',
      'tl',
      'ta',
      'th',
      'tr',
      'uk',
      'ur',
      'vi',
      'cy',
    ]
  }

  /**
   * Get supported models
   */
  getSupportedModels(): string[] {
    return ['whisper-1']
  }

  /**
   * Get maximum file size (OpenAI limit)
   */
  getMaxFileSize(): number {
    return 25 * 1024 * 1024 // 25MB
  }

  /**
   * Override validation to include OpenAI-specific checks
   */
  protected validateTranscribeParams(params: TranscribeParams): void {
    super.validateTranscribeParams(params)

    if (!this.getSupportedModels().includes(params.model)) {
      throw new Error(`Unsupported speech-to-text model: ${params.model}`)
    }

    if (params.language && !this.getSupportedLanguages().includes(params.language)) {
      throw new Error(`Unsupported language: ${params.language}`)
    }

    if (
      params.response_format &&
      !['json', 'text', 'srt', 'vtt', 'verbose_json'].includes(params.response_format)
    ) {
      throw new Error(`Unsupported response format: ${params.response_format}`)
    }
  }

  /**
   * Override audio file validation for OpenAI specifics
   */
  protected validateAudioFile(audio: Buffer | string): void {
    super.validateAudioFile(audio)

    if (Buffer.isBuffer(audio)) {
      const maxSize = this.getMaxFileSize()
      if (audio.length > maxSize) {
        throw new Error(`Audio file too large: ${audio.length} bytes (max: ${maxSize} bytes)`)
      }
    }
  }
}
