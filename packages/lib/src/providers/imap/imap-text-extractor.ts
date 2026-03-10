// packages/lib/src/providers/imap/imap-text-extractor.ts

import { convert as htmlToText } from 'html-to-text'
import planer from 'planer'

export class ImapMessageTextExtractorService {
  extractText(plainText: string | undefined, html: string | undefined): string {
    if (plainText) {
      return this.removeReplyQuotations(plainText)
    }

    if (html) {
      const textFromHtml = htmlToText(html, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
        ],
      })
      return this.removeReplyQuotations(textFromHtml)
    }

    return ''
  }

  private removeReplyQuotations(text: string): string {
    try {
      const extracted = planer.extractFrom(text, 'text/plain')
      return extracted || text
    } catch {
      return text
    }
  }
}
