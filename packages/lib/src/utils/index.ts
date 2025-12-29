export async function withRetry<T>(fn: () => Promise<T>, retries = 5, delay = 1000): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    if (retries > 0 && err.code === 429) {
      // Rate limit error
      console.warn(`Rate limit reached. Retrying in ${delay}ms...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      return withRetry(fn, retries - 1, delay * 2)
    }
    throw err
  }
}

export const convertToCents = (priceString: string | null): number | null => {
  if (priceString === null) return null
  return Math.round(parseFloat(priceString) * 100)
}

// export const

export const getNextPageInfo = (response: any) => {
  let pageInfo: string | null = null

  const linkHeader = response.headers.get('link')
  console.log('linkHeader', linkHeader)

  if (linkHeader) {
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
    pageInfo = match ? new URL(match[1]).searchParams.get('page_info') : null
  } else {
    pageInfo = null
  }
  return pageInfo
}

// Export all MIME utilities
export {
  foldMimeHeader,
  encodeRFC2231Filename,
  encodeQuotedPrintable,
  encodeBase64WithLineBreaks,
  generateMimeBoundary,
  validateMimeStructure,
  ensureCRLF,
  parseMultipartMixedResponse,
  validateLineLengths,
} from './mime'

// Export all file utilities
export {
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
} from './file'

// Export all email utilities
export {
  parseEmailString,
  formatEmailAddress,
  extractDomainFromEmail,
  extractEmailAddress,
  formatEmail,
  normalizeEmail,
  isUserEmail,
  extractNameFromHeader,
  isValidEmail,
  emailsAreEquivalent,
  normalizeMessageId,
  htmlToPlainText,
  formatEmailList,
  encodeEmailHeader,
  validateSendAsAddress,
  sanitizeHeaderValue,
  buildThreadingHeaders,
  toGraphRecipients,
  buildGraphFileAttachment,
} from './email'

export {
  formatRelativeTime,
  isSameWeek,
  getStartOfWeek,
  getEndOfWeek,
  formatInTimezone,
  formatRelativeTimeWithTimezone,
  getCurrentTimeInTimezone,
} from './date'
export * from './timezone'

// Export header utilities
export { filterSensitiveHeaders } from './headers'

export {
  getFullName,
  getContactDisplayName,
  getInitials,
  getInitialsFromName,
  type ContactName,
  formatPhoneNumber,
  formatStreetAddress,
  formatCompanyName,
  formatComplexName,
  formatCityName,
} from './contact'

export { titleize, removeExcessiveWhitespace, pluralize, interpretEscapeSequences, incrementTitle } from './strings'

export { parseBoolean } from './parse'

export { generateId } from './generateId'

export { groupConsecutiveComments, getGroupPosition } from './comments'

export {
  formatCurrency,
  parseToCents,
  centsToDollars,
  type CurrencyDisplayOptions,
} from './currency'

export { generateKeyBetween, generateNKeysBetween, BASE_62_DIGITS } from './fractional-indexing'
