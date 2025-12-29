// server/email/ticket-notifications.ts
import { database as db, schema } from '@auxx/database'
import type { ContactEntity, TicketEntity } from '@auxx/database/models'
import { EmailTemplateService, TemplateData } from './email-templates'
import { EmailService } from './email-service'
import { createScopedLogger } from '@auxx/logger'
import { eq, and, not, desc } from 'drizzle-orm'

const logger = createScopedLogger('ticket-notifications')

export class TicketNotificationService {
  private organizationId: string
  private emailService: EmailService

  constructor(organizationId: string) {
    this.organizationId = organizationId
    this.emailService = new EmailService(organizationId)
  }

  async initialize(): Promise<void> {}

  /**
   * Retrieves or generates an internal reference email for a ticket.
   *
   * This method first checks if the ticket already has an internal reference.
   * If not, it finds a verified and active email domain for the organization
   * and creates an internal reference email using the format:
   * `{routingPrefix}{ticket.number}@{domain}`.
   * The generated reference is then stored in the ticket record.
   *
   * @param ticket - The ticket object for which to get the internal reference email
   * @returns A promise that resolves to the internal reference email string
   * @throws Error if no verified email domain is found for the organization
   */
  private async getInternalReferenceEmail(
    ticket: Pick<TicketEntity, 'id' | 'internalReference' | 'number'>
  ): Promise<string> {
    if (ticket.internalReference) {
      return ticket.internalReference
    }

    // Get organization's email domain
    const [mailDomain] = await db.select()
      .from(schema.MailDomain)
      .where(and(
        eq(schema.MailDomain.organizationId, this.organizationId),
        eq(schema.MailDomain.isVerified, true),
        eq(schema.MailDomain.isActive, true)
      ))
      .orderBy(desc(schema.MailDomain.verifiedAt))
      .limit(1)

    if (!mailDomain) {
      throw new Error('No verified email domain found for this organization')
    }

    const internalReference = `${mailDomain.routingPrefix}${ticket.number.toLowerCase()}@${mailDomain.domain}`

    // Update the ticket with the internal reference
    await db.update(schema.Ticket)
      .set({ internalReference })
      .where(eq(schema.Ticket.id, ticket.id))

    return internalReference
  }

  /**
   * Generates a unique message ID for email communications related to a ticket.
   * The message ID follows the format: <type-ticketNumber-timestamp@domain>
   *
   * @param ticket - The ticket object containing ticket information
   * @param reference - Email reference string containing the domain part after '@'
   * @param type - The type of message being generated
   * @returns A formatted string representing a unique message ID
   */
  private generateMessageId(
    ticket: Pick<TicketEntity, 'number'>,
    reference: string,
    type: string
  ): string {
    const domainPart = reference.split('@')[1]
    return `<${type}-${ticket.number}-${Date.now()}@${domainPart}>`
  }

  /**
   * Constructs a full name from a contact object.
   *
   * @param contact - The contact object containing name information
   * @returns A string representing the full name of the contact
   *          If both first and last names exist, returns "firstName lastName"
   *          If only first name exists, returns "firstName"
   *          If only last name exists, returns "lastName"
   *          If neither exists, returns contact.email or 'Customer' as fallback
   */
  private getFullName(contact: Pick<ContactEntity, 'firstName' | 'lastName' | 'email'>): string {
    if (!contact) return 'Customer'

    if (contact.firstName && contact.lastName) {
      return `${contact.firstName} ${contact.lastName}`
    } else if (contact.firstName) {
      return contact.firstName
    } else if (contact.lastName) {
      return contact.lastName
    } else {
      return contact.email || 'Customer'
    }
  }

  /**
   * Sends a notification email to a contact when a new ticket is created.
   *
   * This method:
   * 1. Fetches the ticket with its related contact, organization, and creator
   * 2. Gets the internal reference email address
   * 3. Generates a Message-ID for email threading
   * 4. Prepares template data with ticket, customer, and organization information
   * 5. Renders the email template
   * 6. Sends the email to the contact
   *
   * @param ticketId - The ID of the ticket for which to send a notification
   * @returns A promise that resolves to an object containing the email ID and success status
   * @throws {Error} If the ticket is not found or if the email fails to send
   */
  async sendTicketCreatedNotification(ticketId: string): Promise<{ id: string; success: boolean }> {
    try {
      const [ticketData] = await db.select({
        ticket: schema.Ticket,
        contact: schema.Contact,
        organization: schema.Organization,
        createdBy: schema.User
      })
      .from(schema.Ticket)
      .leftJoin(schema.Contact, eq(schema.Contact.id, schema.Ticket.contactId))
      .leftJoin(schema.Organization, eq(schema.Organization.id, schema.Ticket.organizationId))
      .leftJoin(schema.User, eq(schema.User.id, schema.Ticket.createdById))
      .where(eq(schema.Ticket.id, ticketId))
      .limit(1)

      if (!ticketData) {
        throw new Error('Ticket not found')
      }

      const ticket = {
        ...ticketData.ticket,
        contact: ticketData.contact,
        organization: ticketData.organization,
        createdBy: ticketData.createdBy
      }

      // Get the internal reference email
      const internalReference = await this.getInternalReferenceEmail(ticket)

      // Generate a Message-ID
      const messageId = this.generateMessageId(ticket, internalReference, 'ticket')

      // Prepare template data
      const templateData: TemplateData = {
        ticket: {
          id: ticket.id,
          number: ticket.number,
          title: ticket.title,
          status: ticket.status,
          createdAt: ticket.createdAt,
        },
        customer: { name: this.getFullName(ticket.contact), email: ticket.contact.email },
        organization: { name: ticket.organization.name },
      }

      // Render the template
      const template = await EmailTemplateService.renderTemplate(
        this.organizationId,
        'TICKET_CREATED',
        templateData
      )

      // Send the email
      return await this.emailService.sendEmail({
        to: ticket.contact.email!,
        from: internalReference,
        subject: template.subject,
        html: template.bodyHtml,
        text: template.bodyPlain,
        messageId,
        trackingEnabled: true,
      })
    } catch (error) {
      logger.error('Error sending ticket created notification:', { error })
      throw error
    }
  }

  /**
   * Sends an email notification when a reply is added to a ticket.
   *
   * This method retrieves the ticket and reply details, builds email references
   * for threaded conversations, and sends an email to the ticket's contact using
   * the "TICKET_REPLIED" template.
   *
   * @param ticketId - The unique identifier of the ticket
   * @param replyId - The unique identifier of the reply that triggered the notification
   *
   * @returns A promise that resolves to an object containing the message ID and success status
   * @throws Error if the ticket or reply cannot be found
   * @throws Error if there's an issue sending the email (original error is logged and re-thrown)
   *
   * @example
   * try {
   *   const result = await emailService.sendTicketReplyNotification('ticket-123', 'reply-456');
   *   console.log('Email sent:', result.success);
   * } catch (error) {
   *   console.error('Failed to send notification:', error);
   * }
   */
  async sendTicketReplyNotification(
    ticketId: string,
    replyId: string
  ): Promise<{ id: string; success: boolean }> {
    try {
      const [ticketData] = await db.select({
        ticket: schema.Ticket,
        contact: schema.Contact,
        organization: schema.Organization,
      })
      .from(schema.Ticket)
      .leftJoin(schema.Contact, eq(schema.Contact.id, schema.Ticket.contactId))
      .leftJoin(schema.Organization, eq(schema.Organization.id, schema.Ticket.organizationId))
      .where(eq(schema.Ticket.id, ticketId))
      .limit(1)

      if (!ticketData) {
        throw new Error('Ticket not found')
      }

      const [replyData] = await db.select({
        reply: schema.TicketReply,
        createdBy: schema.User
      })
      .from(schema.TicketReply)
      .leftJoin(schema.User, eq(schema.User.id, schema.TicketReply.createdById))
      .where(eq(schema.TicketReply.id, replyId))
      .limit(1)

      if (!replyData) {
        throw new Error('Reply not found')
      }

      const ticket = {
        ...ticketData.ticket,
        contact: ticketData.contact,
        organization: ticketData.organization,
      }

      const reply = {
        ...replyData.reply,
        createdBy: replyData.createdBy
      }

      // Get all previous replies to build the references chain
      const previousReplies = await db.select()
        .from(schema.TicketReply)
        .where(and(
          eq(schema.TicketReply.ticketId, ticketId),
          not(eq(schema.TicketReply.id, replyId))
        ))
        .orderBy(desc(schema.TicketReply.createdAt))
        .limit(5)

      // Get the internal reference email
      const internalReference = await this.getInternalReferenceEmail(ticket)

      // Build the references chain
      const references = previousReplies
        .map((r) => r.messageId)
        .filter(Boolean)
        .join(' ')

      // Get the last message ID to reply to
      const inReplyTo = previousReplies.length > 0 ? previousReplies[0].messageId : null

      // Generate a Message-ID
      const messageId = this.generateMessageId(ticket, internalReference, 'reply')

      // Prepare template data
      const templateData: TemplateData = {
        ticket: {
          id: ticket.id,
          number: ticket.number,
          title: ticket.title,
          status: ticket.status,
        },
        reply: {
          content: reply.content,
          contentPlain: reply.content.replace(/<[^>]*>/g, ''), // Simple HTML to text
        },
        customer: { name: this.getFullName(ticket.contact), email: ticket.contact.email },
        organization: { name: ticket.organization.name },
        agent: { name: reply.createdBy?.name || 'Support Agent' },
      }

      // Render the template
      const template = await EmailTemplateService.renderTemplate(
        this.organizationId,
        'TICKET_REPLIED',
        templateData
      )

      // Send the email
      const result = await this.emailService.sendEmail({
        to: ticket.contact.email!,
        from: internalReference,
        subject: template.subject,
        html: template.bodyHtml,
        text: template.bodyPlain,
        messageId,
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
        trackingEnabled: true,
      })

      // Update the reply with the message ID
      await db.update(schema.TicketReply)
        .set({ messageId })
        .where(eq(schema.TicketReply.id, replyId))

      return result
    } catch (error) {
      logger.error('Error sending ticket reply notification:', { error })
      throw error
    }
  }

  // More notification methods would go here (status changed, assigned, closed, etc.)
}
