// packages/lib/src/email/nodemailer-mailgun-transport/index.ts
import type Mail from 'nodemailer/lib/mailer'
import Mailgun from 'mailgun.js'
import FormData from 'form-data'
import * as Handlebars from 'handlebars'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('mailgun-transport')

/**
 * Configuration options for Mailgun transport
 */
export interface MailgunTransportOptions {
  auth: {
    api_key: string
    domain: string
  }
  host?: string
  url?: string
  protocol?: string
  port?: number
  timeout?: number
}

/**
 * Extended mail options with Mailgun-specific fields
 */
interface ExtendedMailOptions extends Mail.Options {
  template?: {
    name: string
    engine: 'handlebars'
    context?: Record<string, any>
  }
  'o:tag'?: string | string[]
  'o:campaign'?: string
  'o:dkim'?: boolean | 'yes' | 'no'
  'o:deliverytime'?: string
  'o:testmode'?: boolean | 'yes' | 'no'
  'o:tracking'?: boolean | 'yes' | 'no'
  'o:tracking-clicks'?: boolean | 'yes' | 'no' | 'htmlonly'
  'o:tracking-opens'?: boolean | 'yes' | 'no'
  'o:require-tls'?: boolean | 'yes' | 'no'
  'o:skip-verification'?: boolean | 'yes' | 'no'
  'X-Mailgun-Variables'?: string | Record<string, any>
  'recipient-variables'?: Record<string, any>
  'h:Reply-To'?: string
  'h:Message-Id'?: string
  [key: string]: any
}

/**
 * Whitelist of allowed Mailgun fields and their mappings
 */
const FIELD_WHITELIST: Array<[string | RegExp, string?]> = [
  ['replyTo', 'h:Reply-To'],
  ['messageId', 'h:Message-Id'],
  [/^h:/],
  [/^v:/],
  ['from'],
  ['to'],
  ['cc'],
  ['bcc'],
  ['subject'],
  ['text'],
  ['template'],
  ['html'],
  ['attachment'],
  ['inline'],
  ['recipient-variables'],
  ['o:tag'],
  ['o:campaign'],
  ['o:dkim'],
  ['o:deliverytime'],
  ['o:testmode'],
  ['o:tracking'],
  ['o:tracking-clicks'],
  ['o:tracking-opens'],
  ['o:require-tls'],
  ['o:skip-verification'],
  ['X-Mailgun-Variables'],
]

/**
 * Apply whitelist filtering to mail fields
 */
function applyFieldWhitelist(mail: ExtendedMailOptions): Record<string, any> {
  return Object.keys(mail).reduce((acc, key) => {
    const targetKey = FIELD_WHITELIST.reduce(
      (result, [cond, target]) => {
        if (result) return result

        if (cond instanceof RegExp) {
          if (cond.test(key)) return target || key
        } else if (cond === key) {
          return target || key
        }
        return null
      },
      null as string | null
    )

    if (!targetKey || mail[key] === undefined || mail[key] === null) return acc

    return { ...acc, [targetKey]: mail[key] }
  }, {})
}

/**
 * Render Handlebars template
 */
async function renderTemplate(
  mail: ExtendedMailOptions
): Promise<{ template?: null; html?: string }> {
  if (mail.html) {
    return { template: null, html: mail.html as string }
  }

  if (
    !mail.template ||
    typeof mail.template === 'string' ||
    !mail.template.name ||
    mail.template.engine !== 'handlebars'
  ) {
    // Either no template or requesting a Mailgun template
    return {}
  }

  const { name, context = {} } = mail.template

  try {
    // Load and compile template
    const templateSource = readFileSync(resolve(name), 'utf-8')
    const template = Handlebars.compile(templateSource)
    const html = template(context)

    return { template: null, html }
  } catch (error) {
    throw new Error(
      `Failed to render Handlebars template: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Convert attachments to Mailgun format
 */
function makeMailgunAttachments(attachments: Mail.Attachment[] = []): {
  attachment?: any[]
  inline?: any[]
} {
  const [attachment, inline] = attachments.reduce(
    (results, item) => {
      const data =
        typeof item.content === 'string'
          ? Buffer.from(item.content, item.encoding as BufferEncoding)
          : item.content || item.path || undefined

      const mailgunAttachment = {
        data,
        filename: item.cid || item.filename || undefined,
        contentType: item.contentType || undefined,
        knownLength: (item as any).knownLength || undefined,
      }

      const [attachmentList, inlineList] = results

      if (item.cid) {
        return [attachmentList, inlineList.concat(mailgunAttachment)]
      } else {
        return [attachmentList.concat(mailgunAttachment), inlineList]
      }
    },
    [[] as any[], [] as any[]]
  )

  return {
    ...(attachment.length ? { attachment } : {}),
    ...(inline.length ? { inline } : {}),
  }
}

/**
 * Convert address objects to text format
 */
function makeAllTextAddresses(mail: ExtendedMailOptions): Record<string, string> {
  const keys = ['from', 'to', 'cc', 'bcc', 'replyTo'] as const

  const makeTextAddresses = (addresses: any): string => {
    const validAddresses = [].concat(addresses).filter(Boolean)

    const textAddresses = validAddresses.map((item) => {
      if (typeof item === 'object' && item.address) {
        return item.name ? `${item.name} <${item.address}>` : item.address
      } else if (typeof item === 'string') {
        return item
      }
      return null
    })

    return textAddresses.filter(Boolean).join(', ')
  }

  return keys.reduce((result, key) => {
    const value = mail[key]
    if (!value) return result

    const textAddresses = makeTextAddresses(value)
    if (!textAddresses) return result

    return { ...result, [key]: textAddresses }
  }, {})
}

/**
 * Create Mailgun transport for Nodemailer
 */
export function createMailgunTransport(options: MailgunTransportOptions): any {
  const mailgun = new Mailgun(FormData as any)

  // Build URL
  let url = options.url
  if (!url && options.host) {
    const generatedUrl = new URL(`https://${options.host || 'api.mailgun.net'}`)
    generatedUrl.protocol = options.protocol || 'https:'
    if (options.port) {
      generatedUrl.port = String(options.port)
    }
    url = generatedUrl.href
  }

  // Create Mailgun client
  const mgClient = mailgun.client({
    username: 'api',
    key: options.auth.api_key,
    url: url || 'https://api.mailgun.net',
    timeout: options.timeout,
  })

  // Send function for Nodemailer
  const send = (mail: Mail.Options, callback?: (err: Error | null, info?: any) => void) => {
    const done =
      typeof callback === 'function'
        ? callback
        : (error: Error | null, info?: any) => {
            logger.error('Mailgun transport received non-function callback', {
              callbackType: typeof callback,
              error: error ? error.message : null,
              info,
            })
          }

    // Wrap async logic in an IIFE to handle promises properly
    void (async () => {
      try {
        // Process mail data
        const nodemailerMail = mail as Mail.Options & {
          data?: ExtendedMailOptions
          message?: { messageId?: () => string }
        }

        const baseData: ExtendedMailOptions = nodemailerMail.data
          ? { ...nodemailerMail.data }
          : { ...(mail as ExtendedMailOptions) }

        const fallbackKeys = [
          'from',
          'to',
          'cc',
          'bcc',
          'subject',
          'text',
          'html',
          'replyTo',
          'inReplyTo',
          'references',
          'attachments',
          'headers',
        ] as const

        for (const key of fallbackKeys) {
          if ((baseData as any)[key] === undefined && (nodemailerMail as any)[key] !== undefined) {
            ;(baseData as any)[key] = (nodemailerMail as any)[key]
          }
        }

        if (!baseData.messageId) {
          const composerMessageId =
            typeof nodemailerMail.message?.messageId === 'function'
              ? nodemailerMail.message.messageId()
              : undefined
          if (composerMessageId) {
            ;(baseData as any).messageId = composerMessageId
          }
        }

        const addresses = makeAllTextAddresses(baseData)
        const attachments = makeMailgunAttachments(baseData.attachments ?? [])
        const templateData = await renderTemplate(baseData)

        // Merge all data
        const processedMail = {
          ...baseData,
          ...addresses,
          ...attachments,
          ...templateData,
        }

        // Apply whitelist
        logger.info('Before whitelist filtering', {
          processedMailKeys: Object.keys(processedMail),
          processedMail: JSON.stringify(processedMail, null, 2),
        })

        const whitelistedMail = applyFieldWhitelist(processedMail)

        logger.info('After whitelist filtering', {
          whitelistedMailKeys: Object.keys(whitelistedMail),
          whitelistedMail: JSON.stringify(whitelistedMail, null, 2),
        })

        // Validate required fields
        const requiredFields = ['from', 'to', 'subject']
        const missingFields = requiredFields.filter((field) => !whitelistedMail[field])
        if (missingFields.length > 0) {
          throw new Error(`Missing required fields: ${missingFields.join(', ')}`)
        }

        // Ensure at least one content field exists
        const hasTextContent =
          typeof whitelistedMail.text === 'string'
            ? Boolean(whitelistedMail.text.trim())
            : Boolean(whitelistedMail.text)
        const hasHtmlContent =
          typeof whitelistedMail.html === 'string'
            ? Boolean(whitelistedMail.html.trim())
            : Boolean(whitelistedMail.html)
        if (!hasTextContent && !hasHtmlContent) {
          throw new Error('Email must have either text or html content')
        }

        // Debug logging
        logger.info('Sending email to Mailgun', {
          domain: options.auth.domain,
          to: whitelistedMail.to,
          subject: whitelistedMail.subject,
          hasText: hasTextContent,
          hasHtml: hasHtmlContent,
          fieldCount: Object.keys(whitelistedMail).length,
        })

        // Send via Mailgun
        const result = await mgClient.messages.create(options.auth.domain, whitelistedMail as any)

        logger.info('Email sent successfully', { messageId: result.id })

        // Ensure callback is a function before calling
        done(null, {
          messageId: result.id,
          id: result.id,
          message: result.message,
        })
      } catch (error) {
        logger.error('Failed to send email via Mailgun', { error })

        done(error as Error)
      }
    })().catch((error) => {
      // Handle any unhandled promise rejections in the IIFE
      logger.error('Unhandled error in send function', { error })
      done(error)
    })
  }

  // Return transport object compatible with Nodemailer
  return {
    name: 'Mailgun',
    version: '1.0.0',
    send,
    verify: (callback: (err: Error | null, success?: boolean) => void) => {
      // Basic verification - check if we can connect
      mgClient.domains
        .list()
        .then(() => callback(null, true))
        .catch((err) => callback(err))
    },
  }
}

export default createMailgunTransport
