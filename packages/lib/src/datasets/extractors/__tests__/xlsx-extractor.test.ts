// packages/lib/src/datasets/extractors/__tests__/xlsx-extractor.test.ts

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { AuxxError } from '../../../errors'
import { XlsxExtractor } from '../xlsx-extractor'

type SheetRows = Record<string, string[][]>

function buildWorkbookBuffer(sheets: SheetRows): Buffer {
  const workbook = XLSX.utils.book_new()

  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName)
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('XlsxExtractor', () => {
  describe('supports', () => {
    it('supports the OpenXML spreadsheet mime types', () => {
      const extractor = new XlsxExtractor(Buffer.alloc(0))

      expect(
        extractor.supports('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '')
      ).toBe(true)
      expect(
        extractor.supports(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
          ''
        )
      ).toBe(true)
    })

    it('supports the legacy Excel mime type', () => {
      const extractor = new XlsxExtractor(Buffer.alloc(0))

      expect(extractor.supports('application/vnd.ms-excel', '')).toBe(true)
    })

    it('supports extension matching with and without a leading dot', () => {
      const extractor = new XlsxExtractor(Buffer.alloc(0))

      expect(extractor.supports('application/octet-stream', 'xlsx')).toBe(true)
      expect(extractor.supports('application/octet-stream', '.XLSX')).toBe(true)
      expect(extractor.supports('application/octet-stream', '.xls')).toBe(true)
      expect(extractor.supports('application/octet-stream', '.xlsm')).toBe(true)
    })

    it('does not support unrelated types', () => {
      const extractor = new XlsxExtractor(Buffer.alloc(0))

      expect(extractor.supports('application/pdf', '.pdf')).toBe(false)
      expect(extractor.supports('text/plain', '.txt')).toBe(false)
    })
  })

  describe('getPriority', () => {
    it('ranks OpenXML spreadsheets above legacy Excel files', () => {
      const extractor = new XlsxExtractor(Buffer.alloc(0))

      const openXml = extractor.getPriority(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xlsx'
      )
      const legacy = extractor.getPriority('application/vnd.ms-excel', '.xls')

      expect(openXml).toBeGreaterThan(legacy)
      expect(legacy).toBeGreaterThan(0)
      expect(extractor.getPriority('application/pdf', '.pdf')).toBe(0)
    })
  })

  describe('getSupportedTypes', () => {
    it('declares the OpenXML and legacy mime types', () => {
      const capabilities = new XlsxExtractor(Buffer.alloc(0)).getSupportedTypes()

      expect(capabilities.mimeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      expect(capabilities.mimeTypes).toContain('application/vnd.ms-excel')
      expect(capabilities.extensions).toContain('.xlsx')
      expect(capabilities.extensions).toContain('.xls')
    })
  })

  describe('extract', () => {
    it('renders a single sheet as CSV under a sheet heading', async () => {
      const buffer = buildWorkbookBuffer({
        Orders: [
          ['id', 'total'],
          ['1', '9.99'],
        ],
      })

      const result = await new XlsxExtractor(buffer, 'orders.xlsx').extract()

      expect(result.content).toBe('# Orders\nid,total\n1,9.99')
      expect(result.extractorUsed).toBe('xlsx-extractor')
      expect(result.wordCount).toBeGreaterThan(0)
      expect(result.metadata.format).toBe('xlsx')
      expect(result.metadata.outputMimeType).toBe('text/csv')
      expect(result.metadata.sheetNames).toEqual(['Orders'])
      expect(result.metadata.sheetCount).toBe(1)
    })

    it('emits every sheet of a multi-sheet workbook with its own heading', async () => {
      const buffer = buildWorkbookBuffer({
        First: [['a', 'b']],
        Second: [['c', 'd']],
      })

      const result = await new XlsxExtractor(buffer).extract()

      expect(result.content).toBe('# First\na,b\n\n# Second\nc,d')
      expect(result.metadata.sheetNames).toEqual(['First', 'Second'])
      expect(result.metadata.sheetCount).toBe(2)
    })

    it('skips empty sheets but keeps the total sheet count', async () => {
      const buffer = buildWorkbookBuffer({
        Empty: [],
        Data: [['x', 'y']],
      })

      const result = await new XlsxExtractor(buffer).extract()

      expect(result.content).toBe('# Data\nx,y')
      expect(result.metadata.sheetNames).toEqual(['Data'])
      expect(result.metadata.sheetCount).toBe(1)
      expect(result.metadata.totalSheetCount).toBe(2)
    })

    it('throws an AuxxError when the buffer is a corrupt workbook', async () => {
      // Zip magic bytes so xlsx commits to the OpenXML path, then garbage.
      const extractor = new XlsxExtractor(
        Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('corrupt')])
      )

      await expect(extractor.extract()).rejects.toBeInstanceOf(AuxxError)
      await expect(extractor.extract()).rejects.toThrow(/XLSX extraction failed/)
    })

    it('throws an AuxxError when every sheet is empty', async () => {
      const buffer = buildWorkbookBuffer({ Empty: [] })

      const extractor = new XlsxExtractor(buffer)

      await expect(extractor.extract()).rejects.toBeInstanceOf(AuxxError)
    })
  })
})
