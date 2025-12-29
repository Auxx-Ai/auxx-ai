// server/api/routers/email-templates.ts
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { EmailTemplateService } from '@auxx/lib/email'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('api-email-templates')

// Define the template types
const templateTypes = [
  'TICKET_CREATED',
  'TICKET_REPLIED',
  'TICKET_CLOSED',
  'TICKET_REOPENED',
  'TICKET_ASSIGNED',
  'TICKET_STATUS_CHANGED',
  'CUSTOM',
] as const

export const emailTemplateRouter = createTRPCRouter({
  // Get all templates for the organization
  getTemplates: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    const templates = await EmailTemplateService.getTemplates(organizationId)

    return { templates }
  }),

  // Get a single template
  getTemplate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id } = input

      const [template] = await ctx.db.select()
        .from(schema.EmailTemplate)
        .where(and(
          eq(schema.EmailTemplate.id, id),
          eq(schema.EmailTemplate.organizationId, organizationId)
        ))
        .limit(1)

      if (!template) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Template not found' })
      }

      return { template }
    }),

  // Create a new template
  createTemplate: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        type: z.enum(templateTypes),
        subject: z.string().min(1),
        bodyHtml: z.string().min(1),
        bodyPlain: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { name, description, type, subject, bodyHtml, bodyPlain, isActive } = input
      try {
        const template = await EmailTemplateService.createTemplate(organizationId, {
          name,
          description: description || '',
          type: type as any,
          subject,
          bodyHtml,
          bodyPlain,
          isActive: isActive ?? true,
        })

        return { success: true, template }
      } catch (error) {
        logger.error('Error creating template:', { error })
        throw new Error(error instanceof Error ? error.message : 'Unknown error')
      }
    }),

  // Update a template
  updateTemplate: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        subject: z.string().min(1).optional(),
        bodyHtml: z.string().min(1).optional(),
        bodyPlain: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // const organizationId = ctx.session.user.organizationId
      const { organizationId } = ctx.session
      const { id, name, description, subject, bodyHtml, bodyPlain, isActive } = input
      try {
        // Check if template exists and belongs to organization
        const [existingTemplate] = await ctx.db.select()
          .from(schema.EmailTemplate)
          .where(and(
            eq(schema.EmailTemplate.id, id),
            eq(schema.EmailTemplate.organizationId, organizationId)
          ))
          .limit(1)

        if (!existingTemplate) {
          throw new Error('Template not found')
        }

        // Update the template
        const [template] = await ctx.db.update(schema.EmailTemplate)
          .set({
            name,
            description,
            subject,
            bodyHtml,
            bodyPlain,
            isActive,
            updatedAt: new Date(),
          })
          .where(eq(schema.EmailTemplate.id, id))
          .returning()

        return { success: true, template }
      } catch (error) {
        console.error('Error updating template:', error)
        throw new Error(error instanceof Error ? error.message : 'Unknown error')
      }
    }),

  // Delete a template
  deleteTemplate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id } = input

      try {
        // Check if template exists and belongs to organization
        const [existingTemplate] = await ctx.db.select()
          .from(schema.EmailTemplate)
          .where(and(
            eq(schema.EmailTemplate.id, id),
            eq(schema.EmailTemplate.organizationId, organizationId)
          ))
          .limit(1)

        if (!existingTemplate) {
          throw new Error('Template not found')
        }

        // Delete the template
        await ctx.db.delete(schema.EmailTemplate)
          .where(eq(schema.EmailTemplate.id, id))

        return { success: true }
      } catch (error) {
        logger.error('Error deleting template:', { error })
        throw new Error(error instanceof Error ? error.message : 'Unknown error')
      }
    }),

  // Preview a template with sample data
  previewTemplate: protectedProcedure
    .input(
      z.object({
        templateId: z.string().optional(),
        type: z.enum(templateTypes).optional(),
        subject: z.string().optional(),
        bodyHtml: z.string().optional(),
        bodyPlain: z.string().optional(),
        sampleData: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { templateId, type, subject, bodyHtml, bodyPlain } = input

      try {
        let template

        if (templateId) {
          // Get existing template
          const [foundTemplate] = await ctx.db.select()
            .from(schema.EmailTemplate)
            .where(and(
              eq(schema.EmailTemplate.id, templateId),
              eq(schema.EmailTemplate.organizationId, organizationId)
            ))
            .limit(1)
          template = foundTemplate

          if (!template) {
            throw new Error('Template not found')
          }
        } else if (subject && bodyHtml) {
          // Use provided content
          template = { subject, bodyHtml, bodyPlain: bodyPlain || '', type: type || 'CUSTOM' }
        } else {
          throw new Error('Either templateId or content must be provided')
        }

        // Get organization info
        const [organization] = await ctx.db.select({ name: schema.Organization.name })
          .from(schema.Organization)
          .where(eq(schema.Organization.id, organizationId))
          .limit(1)

        // Create sample data based on template type
        const sampleData =
          input.sampleData || createSampleData(template.type, organization?.name || 'Your Company')

        // Render the template
        const renderResult = await renderSampleTemplate(
          template.subject,
          template.bodyHtml,
          template.bodyPlain || '',
          sampleData
        )

        return { success: true, preview: renderResult }
      } catch (error) {
        logger.error('Error previewing template:', { error })
        throw new Error(error instanceof Error ? error.message : 'Unknown error')
      }
    }),
})

// Helper function to render a template with sample data
async function renderSampleTemplate(
  subject: string,
  bodyHtml: string,
  bodyPlain: string,
  data: Record<string, any>
) {
  const Handlebars = await import('handlebars').then((m) => m.default || m)

  // Register helpers
  Handlebars.registerHelper('formatDate', function (date: Date) {
    if (!date) return ''
    const d = new Date(date)
    return d.toLocaleDateString()
  })

  Handlebars.registerHelper('ifEquals', function (arg1: any, arg2: any, options: any) {
    return arg1 === arg2 ? options.fn(this) : options.inverse(this)
  })

  try {
    // Compile templates
    const subjectTemplate = Handlebars.compile(subject)
    const bodyHtmlTemplate = Handlebars.compile(bodyHtml)
    const bodyPlainTemplate = Handlebars.compile(bodyPlain)

    // Render with data
    const renderedSubject = subjectTemplate(data)
    const renderedBodyHtml = bodyHtmlTemplate(data)
    const renderedBodyPlain = bodyPlainTemplate(data)

    return { subject: renderedSubject, bodyHtml: renderedBodyHtml, bodyPlain: renderedBodyPlain }
  } catch (error) {
    console.error('Error rendering sample template:', error)
    throw new Error('Failed to render template preview')
  }
}

// Helper function to create sample data based on template type
function createSampleData(type: string, organizationName: string) {
  const now = new Date()
  const ticketNumber = 'TKT-123456'

  const baseData = {
    ticket: {
      id: '12345',
      number: ticketNumber,
      title: 'Sample Ticket Title',
      status: 'OPEN',
      createdAt: now,
      closedAt: new Date(now.getTime() + 86400000), // +1 day
    },
    customer: { name: 'John Doe', email: 'john.doe@example.com' },
    organization: { name: organizationName },
    agent: { name: 'Jane Smith' },
  }

  switch (type) {
    case 'TICKET_REPLIED':
      return {
        ...baseData,
        reply: {
          content:
            '<p>Thank you for contacting us. We have looked into your issue and have the following solution:</p><p>Please try restarting your device and clearing your cache. This should resolve the problem you are experiencing.</p><p>Let us know if you need further assistance.</p>',
          contentPlain:
            'Thank you for contacting us. We have looked into your issue and have the following solution:\n\nPlease try restarting your device and clearing your cache. This should resolve the problem you are experiencing.\n\nLet us know if you need further assistance.',
        },
      }

    case 'TICKET_ASSIGNED':
      return { ...baseData, assignee: { name: 'Jane Smith', email: 'jane.smith@example.com' } }

    case 'TICKET_STATUS_CHANGED':
      return {
        ...baseData,
        statusChange: {
          oldStatus: 'OPEN',
          newStatus: 'IN_PROGRESS',
          reason: 'An agent has started working on your ticket',
        },
      }

    // For all other types, use the base data
    default:
      return baseData
  }
}
