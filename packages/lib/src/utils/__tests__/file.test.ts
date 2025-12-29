// packages/lib/src/utils/__tests__/file.test.ts

import { describe, test, expect } from 'vitest'
import {
  formatBytes,
  getFileExtension,
  getDirectoryPath,
  isImageFile,
  isPreviewableImage,
  sanitizeFilename,
  calculateBase64Size,
  validateAttachmentSizes,
  getMimeTypeFromExtension,
  getAttachmentByteSize,
  getFilenameFromPath,
} from '../file'

describe('File Utilities', () => {
  describe('formatBytes', () => {
    test('formats bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 B')
      expect(formatBytes(1)).toBe('1 B')
      expect(formatBytes(1024)).toBe('1 KB')
      expect(formatBytes(1024 * 1024)).toBe('1 MB')
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
      expect(formatBytes(1536)).toBe('1.5 KB')
      expect(formatBytes(1234567890)).toBe('1.15 GB')
    })

    test('handles bigint values', () => {
      expect(formatBytes(BigInt(1024))).toBe('1 KB')
      expect(formatBytes(BigInt(1024 * 1024))).toBe('1 MB')
    })

    test('handles invalid input', () => {
      expect(formatBytes(null as any)).toBe('0 B')
      expect(formatBytes(undefined as any)).toBe('0 B')
      expect(formatBytes(-100)).toBe('0 B')
      expect(formatBytes(NaN)).toBe('0 B')
    })

    test('respects decimal parameter', () => {
      expect(formatBytes(1536, 0)).toBe('2 KB')
      expect(formatBytes(1536, 1)).toBe('1.5 KB')
      expect(formatBytes(1536, 3)).toBe('1.5 KB')
    })
  })

  describe('getFileExtension', () => {
    test('extracts file extensions correctly', () => {
      expect(getFileExtension('file.txt')).toBe('txt')
      expect(getFileExtension('document.pdf')).toBe('pdf')
      expect(getFileExtension('image.JPEG')).toBe('jpeg')
      expect(getFileExtension('archive.tar.gz')).toBe('gz')
    })

    test('handles edge cases', () => {
      expect(getFileExtension('noextension')).toBe('noextension') // Returns the full string if no dot
      expect(getFileExtension('.hidden')).toBe('hidden')
      expect(getFileExtension('')).toBe('')
    })
  })

  describe('getDirectoryPath', () => {
    test('extracts directory paths correctly', () => {
      expect(getDirectoryPath('/home/user/file.txt')).toBe('/home/user')
      expect(getDirectoryPath('/root/file.txt')).toBe('/root')
      expect(getDirectoryPath('/file.txt')).toBe('/') // Returns '/' for files at root
    })

    test('handles edge cases', () => {
      expect(getDirectoryPath('/')).toBe('/')
      expect(getDirectoryPath('')).toBe('/')
      expect(getDirectoryPath('file.txt')).toBe('/')
    })
  })

  describe('isImageFile', () => {
    test('identifies image MIME types correctly', () => {
      expect(isImageFile('image/jpeg')).toBe(true)
      expect(isImageFile('image/png')).toBe(true)
      expect(isImageFile('image/gif')).toBe(true)
      expect(isImageFile('image/svg+xml')).toBe(true)
      expect(isImageFile('image/webp')).toBe(true)
    })

    test('rejects non-image types', () => {
      expect(isImageFile('text/plain')).toBe(false)
      expect(isImageFile('application/pdf')).toBe(false)
      expect(isImageFile('video/mp4')).toBe(false)
    })

    test('handles invalid input', () => {
      expect(isImageFile(null)).toBe(false)
      expect(isImageFile(undefined)).toBe(false)
      expect(isImageFile('')).toBe(false)
    })
  })

  describe('isPreviewableImage', () => {
    test('includes safe image types', () => {
      expect(isPreviewableImage('image/jpeg')).toBe(true)
      expect(isPreviewableImage('image/jpg')).toBe(true)
      expect(isPreviewableImage('image/png')).toBe(true)
      expect(isPreviewableImage('image/gif')).toBe(true)
      expect(isPreviewableImage('image/webp')).toBe(true)
    })

    test('excludes SVG for security', () => {
      expect(isPreviewableImage('image/svg+xml')).toBe(false)
    })

    test('rejects non-image types', () => {
      expect(isPreviewableImage('text/plain')).toBe(false)
      expect(isPreviewableImage('application/pdf')).toBe(false)
    })

    test('handles invalid input', () => {
      expect(isPreviewableImage(null)).toBe(false)
      expect(isPreviewableImage(undefined)).toBe(false)
      expect(isPreviewableImage('')).toBe(false)
    })

    test('is case insensitive', () => {
      expect(isPreviewableImage('IMAGE/JPEG')).toBe(true)
      expect(isPreviewableImage('Image/Png')).toBe(true)
      expect(isPreviewableImage('IMAGE/GIF')).toBe(true)
    })
  })

  describe('sanitizeFilename', () => {
    test('removes dangerous characters', () => {
      expect(sanitizeFilename('file<>:"/\\|?*.txt')).toBe('file_________.txt') // 9 dangerous chars + * = 10 underscores
      expect(sanitizeFilename('file\r\n.txt')).toBe('file.txt')
    })

    test('handles length limits', () => {
      const longName = 'a'.repeat(300) + '.txt'
      const sanitized = sanitizeFilename(longName)
      expect(sanitized.length).toBeLessThanOrEqual(255)
      expect(sanitized.endsWith('.txt')).toBe(true)
    })

    test('preserves extension by default', () => {
      const longName = 'a'.repeat(300) + '.pdf'
      const sanitized = sanitizeFilename(longName)
      expect(sanitized.endsWith('.pdf')).toBe(true)
    })

    test('handles empty input', () => {
      expect(sanitizeFilename('')).toBe('unnamed')
      expect(sanitizeFilename('   ')).toBe('unnamed')
    })

    test('respects custom options', () => {
      expect(sanitizeFilename('file<>test.txt', { replacementChar: '-' })).toBe('file--test.txt')
      expect(sanitizeFilename('verylongfilename.txt', { maxLength: 10 })).toBe('verylo.txt')
    })
  })

  describe('calculateBase64Size', () => {
    test('calculates base64 size correctly', () => {
      expect(calculateBase64Size(3)).toBe(4)
      expect(calculateBase64Size(6)).toBe(8)
      expect(calculateBase64Size(100)).toBe(134)
      expect(calculateBase64Size(1024)).toBe(1366)
    })

    test('handles edge cases', () => {
      expect(calculateBase64Size(0)).toBe(0)
      expect(calculateBase64Size(1)).toBe(2)
      expect(calculateBase64Size(2)).toBe(3)
    })
  })

  describe('validateAttachmentSizes', () => {
    const limits = {
      maxSingleSize: 1024 * 1024, // 1MB
      maxTotalSize: 5 * 1024 * 1024, // 5MB
    }

    test('validates valid attachments', () => {
      const attachments = [
        { size: 500000, filename: 'file1.txt' },
        { size: 300000, filename: 'file2.pdf' },
      ]
      const result = validateAttachmentSizes(attachments, limits)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    test('detects single file size violations', () => {
      const attachments = [
        { size: 2 * 1024 * 1024, filename: 'large.pdf' },
      ]
      const result = validateAttachmentSizes(attachments, limits)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].filename).toBe('large.pdf')
    })

    test('detects total size violations', () => {
      const attachments = [
        { size: 1000000, filename: 'file1.txt' }, // 1MB each
        { size: 1000000, filename: 'file2.txt' },
        { size: 1000000, filename: 'file3.txt' },
        { size: 1000000, filename: 'file4.txt' },
        { size: 1000000, filename: 'file5.txt' },
      ]
      const result = validateAttachmentSizes(attachments, limits)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.filename === 'Total attachments')).toBe(true)
    })
  })

  describe('getMimeTypeFromExtension', () => {
    test('returns correct MIME types for common extensions', () => {
      expect(getMimeTypeFromExtension('test.jpg')).toBe('image/jpeg')
      expect(getMimeTypeFromExtension('document.pdf')).toBe('application/pdf')
      expect(getMimeTypeFromExtension('file.txt')).toBe('text/plain')
      expect(getMimeTypeFromExtension('data.json')).toBe('application/json')
      expect(getMimeTypeFromExtension('style.css')).toBe('text/css')
      expect(getMimeTypeFromExtension('script.js')).toBe('application/javascript')
    })

    test('returns default for unknown extensions', () => {
      expect(getMimeTypeFromExtension('file.xyz')).toBe('application/octet-stream')
      expect(getMimeTypeFromExtension('unknown')).toBe('application/octet-stream')
    })

    test('handles case sensitivity', () => {
      expect(getMimeTypeFromExtension('IMAGE.JPG')).toBe('image/jpeg')
      expect(getMimeTypeFromExtension('Document.PDF')).toBe('application/pdf')
    })
  })

  describe('getAttachmentByteSize', () => {
    test('returns size property if available', () => {
      expect(getAttachmentByteSize({ size: 1024 })).toBe(1024)
    })

    test('calculates size from Buffer content', () => {
      const buffer = Buffer.from('Hello World')
      expect(getAttachmentByteSize({ content: buffer })).toBe(11)
    })

    test('calculates size from string content', () => {
      expect(getAttachmentByteSize({ content: 'Hello World' })).toBe(11)
    })

    test('handles empty or missing content', () => {
      expect(getAttachmentByteSize({})).toBe(0)
      expect(getAttachmentByteSize({ content: '' })).toBe(0)
    })

    test('prefers size property over content', () => {
      expect(getAttachmentByteSize({ 
        size: 100, 
        content: 'This is much longer content' 
      })).toBe(100)
    })
  })

  describe('getFilenameFromPath', () => {
    test('extracts filename from Unix paths', () => {
      expect(getFilenameFromPath('/home/user/document.pdf')).toBe('document.pdf')
      expect(getFilenameFromPath('/root/file.txt')).toBe('file.txt')
      expect(getFilenameFromPath('folder/subfolder/image.jpg')).toBe('image.jpg')
    })

    test('extracts filename from Windows paths', () => {
      expect(getFilenameFromPath('C:\\Users\\User\\document.pdf')).toBe('document.pdf')
      expect(getFilenameFromPath('D:\\folder\\file.txt')).toBe('file.txt')
    })

    test('handles edge cases', () => {
      expect(getFilenameFromPath('file.txt')).toBe('file.txt')
      expect(getFilenameFromPath('')).toBe('')
      expect(getFilenameFromPath('/')).toBe('')
      expect(getFilenameFromPath('\\')).toBe('')
    })

    test('handles mixed path separators', () => {
      expect(getFilenameFromPath('/unix/path\\windows\\file.txt')).toBe('file.txt')
    })
  })
})