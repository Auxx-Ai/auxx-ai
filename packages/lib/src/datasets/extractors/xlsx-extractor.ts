// packages/lib/src/datasets/extractors/xlsx-extractor.ts

import * as XLSX from 'xlsx'
import { UnprocessableEntityError } from '../../errors'
import type { ExtractionResult, ExtractorCapabilities } from '../types/extractor.types'
import { BaseExtractor } from './base-extractor'
import { ExtractorRegistry } from './extractor-registry'

const OPENXML_SPREADSHEET_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
]

const LEGACY_SPREADSHEET_MIME_TYPE = 'application/vnd.ms-excel'

const OPENXML_SPREADSHEET_EXTENSIONS = ['.xlsx', '.xlsm', '.xltx', '.xltm']

const LEGACY_SPREADSHEET_EXTENSIONS = ['.xls', '.xlt']

/**
 * Spreadsheet extractor using the xlsx library.
 *
 * Every non-empty sheet of the workbook is rendered as CSV and prefixed with a
 * `# <sheet name>` heading so a downstream reader can tell the sheets apart.
 */
export class XlsxExtractor extends BaseExtractor {
  getName(): string {
    return 'xlsx-extractor'
  }

  supports(mimeType: string, extension: string): boolean {
    const capabilities = this.getSupportedTypes()
    const normalizedExt = this.normalizeExtension(extension)

    return (
      capabilities.mimeTypes.includes(mimeType) || capabilities.extensions.includes(normalizedExt)
    )
  }

  getPriority(mimeType: string, extension: string): number {
    const normalizedExt = this.normalizeExtension(extension)

    // High priority for OpenXML spreadsheets
    if (
      OPENXML_SPREADSHEET_MIME_TYPES.includes(mimeType) ||
      OPENXML_SPREADSHEET_EXTENSIONS.includes(normalizedExt)
    ) {
      return 93
    }

    // Lower priority for legacy Excel files (limited support)
    if (
      mimeType === LEGACY_SPREADSHEET_MIME_TYPE ||
      LEGACY_SPREADSHEET_EXTENSIONS.includes(normalizedExt)
    ) {
      return 75
    }

    return 0
  }

  getSupportedTypes(): ExtractorCapabilities {
    return {
      mimeTypes: [...OPENXML_SPREADSHEET_MIME_TYPES, LEGACY_SPREADSHEET_MIME_TYPE],
      extensions: [...OPENXML_SPREADSHEET_EXTENSIONS, ...LEGACY_SPREADSHEET_EXTENSIONS],
      maxFileSize: 50 * 1024 * 1024, // 50MB for spreadsheets
      requiresNetwork: false,
      supportsOCR: false,
      supportsImages: false,
    }
  }

  async extract(): Promise<ExtractionResult> {
    const startTime = Date.now()

    try {
      // Use the fileContent Buffer directly (already available)
      const buffer = this.fileContent

      // Parse workbook with timeout
      const workbook = await this.withTimeout(this.parseWorkbook(buffer), this.options.timeout)

      const sheetNames = workbook.SheetNames ?? []
      const renderedSheets: string[] = []
      const includedSheetNames: string[] = []

      for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName]
        if (!sheet) continue

        const csv = XLSX.utils.sheet_to_csv(sheet).trim()

        // Skip empty sheets
        if (csv.length === 0) continue

        renderedSheets.push(`# ${sheetName}\n${csv}`)
        includedSheetNames.push(sheetName)
      }

      // Clean and validate content
      const content = this.cleanText(renderedSheets.join('\n\n'))
      this.validateContent(content)

      // Count words
      const wordCount = this.countWords(content)

      // Create metadata
      const metadata = this.createMetadata('xlsx', {
        outputMimeType: 'text/csv',
        sheetNames: includedSheetNames,
        sheetCount: includedSheetNames.length,
        totalSheetCount: sheetNames.length,
        extractionMethod: 'xlsx',
      })

      const processingTime = Date.now() - startTime

      const result: ExtractionResult = {
        content,
        wordCount,
        metadata,
        processingTime,
        extractorUsed: this.getName(),
      }

      this.logExtractionMetrics(result)
      return result
    } catch (error) {
      const processingTime = Date.now() - startTime

      throw new UnprocessableEntityError(
        `XLSX extraction failed after ${processingTime}ms: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  /**
   * Parse the workbook using xlsx.
   *
   * Options are a hard-coded literal on purpose — nothing caller-supplied is
   * ever forwarded to `XLSX.read`, and `type` is always `'buffer'`.
   */
  private async parseWorkbook(buffer: Buffer): Promise<XLSX.WorkBook> {
    let workbook: XLSX.WorkBook

    try {
      workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch (error) {
      // Handle common spreadsheet parsing errors
      if (error instanceof Error) {
        if (error.message.includes('password') || error.message.includes('encrypted')) {
          throw new UnprocessableEntityError('Spreadsheet is password protected')
        }
        if (error.message.includes('Unsupported')) {
          throw new UnprocessableEntityError('Unsupported spreadsheet file format')
        }
      }

      throw new UnprocessableEntityError(
        `Spreadsheet parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new UnprocessableEntityError('Spreadsheet contains no sheets')
    }

    return workbook
  }
}

// Auto-register this extractor
ExtractorRegistry.register(XlsxExtractor)
