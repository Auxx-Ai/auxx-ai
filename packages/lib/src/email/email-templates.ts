// server/email/email-templates.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq } from 'drizzle-orm'
import Handlebars from 'handlebars'

const logger = createScopedLogger('email-templates')

// Register Handlebars helpers
Handlebars.registerHelper('formatDate', (date: Date, format: string) => {
  if (!date) return ''
  const d = new Date(date)
  return d.toLocaleDateString()
})

Handlebars.registerHelper('ifEquals', function (arg1: any, arg2: any, options: any) {
  return arg1 === arg2 ? options.fn(this) : options.inverse(this)
})

export interface TemplateData {
  [key: string]: any
}

export interface RenderedTemplate {
  subject: string
  bodyHtml: string
  bodyPlain: string
}

export class EmailTemplateService {
  /**
   * Retrieves an email template for a specific organization and template type.
   *
   * @param organizationId - The ID of the organization to find templates for
   * @param type - The type of email template to retrieve
   * @returns The found email template
   * @throws Error if no template is found for the given type
   */
  static async getTemplate(organizationId: string, type: string) {
    const [template] = await db
      .select()
      .from(schema.EmailTemplate)
      .where(
        and(
          eq(schema.EmailTemplate.organizationId, organizationId),
          eq(schema.EmailTemplate.type, type as any),
          eq(schema.EmailTemplate.isActive, true)
        )
      )
      .orderBy(asc(schema.EmailTemplate.isDefault))
      .limit(1)

    if (!template) {
      logger.error('Template not found:', { organizationId, type })
      throw new Error(`Template not found for type: ${type}`)
    }

    return template
  }
  /**
   * Retrieves all email templates for a specific organization.
   *
   * @param organizationId - The ID of the organization
   * @returns Array of email templates sorted by name
   */
  static async getTemplates(organizationId: string) {
    const templates = await db
      .select()
      .from(schema.EmailTemplate)
      .where(eq(schema.EmailTemplate.organizationId, organizationId))
      .orderBy(asc(schema.EmailTemplate.name))

    return templates
  }

  /**
   * Renders an email template with provided data.
   *
   * @param organizationId - The ID of the organization that owns the template
   * @param type - The type identifier of the template to render
   * @param data - The data object containing values to be inserted into the template
   * @returns A promise that resolves to a RenderedTemplate object containing the rendered subject, HTML body, and plain text body
   * @throws Will throw an error if template rendering fails
   *
   * @example
   * ```typescript
   * const renderedEmail = await EmailTemplates.renderTemplate(
   *   'org_123456',
   *   'welcome_email',
   *   { username: 'johndoe', activationLink: 'https://example.com/activate' }
   * );
   * ```
   */
  static async renderTemplate(
    organizationId: string,
    type: string,
    data: TemplateData
  ): Promise<RenderedTemplate> {
    const template = await EmailTemplateService.getTemplate(organizationId, type)

    try {
      // Compile templates
      const subjectTemplate = Handlebars.compile(template.subject)
      const bodyHtmlTemplate = Handlebars.compile(template.bodyHtml)
      const bodyPlainTemplate = Handlebars.compile(template.bodyPlain || '')

      // Render with data
      const subject = subjectTemplate(data)
      const bodyHtml = bodyHtmlTemplate(data)
      const bodyPlain = bodyPlainTemplate(data)

      return { subject, bodyHtml, bodyPlain }
    } catch (error) {
      logger.error('Error rendering template:', { error, type })
      throw new Error('Failed to render email template')
    }
  }

  /**
   * Creates a new email template for the specified organization.
   *
   * @param organizationId - The ID of the organization that will own the template
   * @param templateData - Object containing the template details
   * @returns A Promise that resolves to the newly created email template
   * @throws Error if a template of the same type already exists (for non-CUSTOM types)
   * @throws Error if there's a database error during creation
   */
  static async createTemplate(
    organizationId: string,
    templateData: {
      name: string
      description: string
      type: string
      subject: string
      bodyHtml: string
      bodyPlain?: string
      variables?: Record<string, any>
      isActive?: boolean
    }
  ) {
    try {
      // For non-CUSTOM types, check if a template of this type already exists
      if (templateData.type !== 'CUSTOM') {
        const [existingTemplate] = await db
          .select({ id: schema.EmailTemplate.id })
          .from(schema.EmailTemplate)
          .where(
            and(
              eq(schema.EmailTemplate.organizationId, organizationId),
              eq(schema.EmailTemplate.type, templateData.type as any)
            )
          )
          .limit(1)

        if (existingTemplate) {
          throw new Error(
            `A template of type "${templateData.type}" already exists. Please edit the existing template instead.`
          )
        }
      }

      const [template] = await db
        .insert(schema.EmailTemplate)
        .values({
          ...templateData,
          organizationId,
          variables: templateData.variables || {},
          isDefault: false,
          isActive: templateData.isActive ?? true,
        } as any)
        .returning()

      logger.info('Template created:', { templateId: template.id, organizationId })
      return template
    } catch (error) {
      logger.error('Error creating template:', { error, organizationId })
      throw error
    }
  }
  /**
   * Copies an existing email template and creates a new custom version for the specified organization.
   *
   * The new template is created with "(Custom)" appended to the original name and
   * preserves all content and configuration from the source template, but sets
   * `isDefault` to false and `isActive` to true.
   *
   * @param templateId - The ID of the source email template to copy
   * @param organizationId - The ID of the organization that will own the new template
   * @returns A Promise that resolves to the newly created email template
   * @throws Error if the source template is not found
   * @throws Error if there's a database error during creation
   */
  static async copyTemplate(templateId: string, organizationId: string) {
    try {
      // Get the source template
      const [sourceTemplate] = await db
        .select()
        .from(schema.EmailTemplate)
        .where(eq(schema.EmailTemplate.id, templateId))
        .limit(1)

      if (!sourceTemplate) {
        throw new Error('Template not found')
      }

      // Create a new custom template
      const [newTemplate] = await db
        .insert(schema.EmailTemplate)
        .values({
          name: `${sourceTemplate.name} (Custom)`,
          description: sourceTemplate.description,
          type: sourceTemplate.type,
          subject: sourceTemplate.subject,
          bodyHtml: sourceTemplate.bodyHtml,
          bodyPlain: sourceTemplate.bodyPlain,
          variables: sourceTemplate.variables,
          isDefault: false,
          isActive: true,
          organizationId,
        } as any)
        .returning()

      logger.info('Template copied:', { sourceId: templateId, newId: newTemplate.id })
      return newTemplate
    } catch (error) {
      logger.error('Error copying template:', { error, templateId })
      throw error
    }
  }
}
