// packages/lib/src/ai/clients/base/speech2text-client.ts

import { BaseSpecializedClient } from './base-specialized-client'
import type { ClientConfig, TranscribeParams, TranscribeResponse } from './types'

/**
 * Abstract base class for speech-to-text clients
 */
export abstract class Speech2TextClient extends BaseSpecializedClient {
  constructor(config: ClientConfig, clientName: string, logger?: any) {
    super(config, clientName, logger)
  }

  // ===== ABSTRACT METHODS =====

  /**
   * Transcribe audio to text
   */
  abstract invoke(params: TranscribeParams): Promise<TranscribeResponse>

  // ===== IMPLEMENTED METHODS =====

  /**
   * Validate transcription parameters
   */
  protected validateTranscribeParams(params: TranscribeParams): void {
    this.validateRequiredParams(params, ['audio', 'model'])

    if (!Buffer.isBuffer(params.audio) && typeof params.audio !== 'string') {
      throw new Error('Audio must be a Buffer or file path string')
    }

    if (params.format && !['json', 'text', 'srt', 'vtt'].includes(params.format)) {
      throw new Error('Format must be one of: json, text, srt, vtt')
    }

    if (params.temperature !== undefined) {
      if (
        typeof params.temperature !== 'number' ||
        params.temperature < 0 ||
        params.temperature > 1
      ) {
        throw new Error('Temperature must be a number between 0 and 1')
      }
    }
  }

  /**
   * Validate audio file size and format
   */
  protected validateAudioFile(audio: Buffer | string): void {
    if (Buffer.isBuffer(audio)) {
      // Check file size (25MB limit for most providers)
      const maxSize = 25 * 1024 * 1024 // 25MB
      if (audio.length > maxSize) {
        throw new Error(`Audio file too large: ${audio.length} bytes (max: ${maxSize} bytes)`)
      }

      // Basic file type detection (very simple)
      const header = audio.slice(0, 12)
      const isValidAudio = this.isValidAudioBuffer(header)

      if (!isValidAudio) {
        this.logger.warn('Audio buffer may not be a valid audio file format')
      }
    } else if (typeof audio === 'string') {
      // File path validation
      if (!audio.trim()) {
        throw new Error('Audio file path cannot be empty')
      }
    }
  }

  /**
   * Simple audio format detection
   */
  private isValidAudioBuffer(header: Buffer): boolean {
    // Check for common audio file signatures
    const signatures = [
      [0xff, 0xfb], // MP3
      [0xff, 0xf3], // MP3
      [0xff, 0xf2], // MP3
      [0x52, 0x49, 0x46, 0x46], // WAV/RIFF
      [0x66, 0x4c, 0x61, 0x43], // FLAC
      [0x4f, 0x67, 0x67, 0x53], // OGG
    ]

    for (const signature of signatures) {
      let matches = true
      for (let i = 0; i < signature.length && i < header.length; i++) {
        if (header[i] !== signature[i]) {
          matches = false
          break
        }
      }
      if (matches) return true
    }

    return false
  }

  /**
   * Convert segments to SRT format
   */
  protected convertToSRT(segments: Array<{ start: number; end: number; text: string }>): string {
    return segments
      .map((segment, index) => {
        const startTime = this.formatSRTTime(segment.start)
        const endTime = this.formatSRTTime(segment.end)
        return `${index + 1}\n${startTime} --> ${endTime}\n${segment.text}\n`
      })
      .join('\n')
  }

  /**
   * Convert segments to VTT format
   */
  protected convertToVTT(segments: Array<{ start: number; end: number; text: string }>): string {
    const header = 'WEBVTT\n\n'
    const body = segments
      .map((segment) => {
        const startTime = this.formatVTTTime(segment.start)
        const endTime = this.formatVTTTime(segment.end)
        return `${startTime} --> ${endTime}\n${segment.text}\n`
      })
      .join('\n')

    return header + body
  }

  /**
   * Format time for SRT (HH:MM:SS,mmm)
   */
  private formatSRTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const milliseconds = Math.floor((seconds % 1) * 1000)

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds
      .toString()
      .padStart(3, '0')}`
  }

  /**
   * Format time for VTT (HH:MM:SS.mmm)
   */
  private formatVTTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const milliseconds = Math.floor((seconds % 1) * 1000)

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${milliseconds
      .toString()
      .padStart(3, '0')}`
  }

  /**
   * Estimate audio duration from buffer size (rough approximation)
   */
  protected estimateAudioDuration(audio: Buffer): number {
    // Very rough estimate: assuming average bitrate of 128kbps
    const averageBitrate = (128 * 1000) / 8 // 128kbps in bytes per second
    return audio.length / averageBitrate
  }
}
