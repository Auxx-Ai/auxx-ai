// packages/sdk/template/src/send-email.server.ts

/**
 * Server-side execution function for the send email workflow block.
 *
 * IMPORTANT: Server functions must be in separate .server.ts files for proper bundling.
 * This allows the build system to:
 * 1. Bundle server code separately from client code
 * 2. Extract and deploy server functions to Lambda
 * 3. Keep server-only code out of the client bundle
 */

import { getUserConnection /*getCurrentUser */ } from '@auxx/sdk/server'
import type { InferWorkflowInput, InferWorkflowOutput } from '@auxx/sdk'
import type { sendEmailSchema } from './send-email.workflow'

/**
 * Server-side execution function.
 * Receives resolved input values (variables already interpolated).
 * Use SDK imports for connections, user info, and other platform features.
 */
export default async function sendEmailExecute(
  input: InferWorkflowInput<typeof sendEmailSchema>
): Promise<InferWorkflowOutput<typeof sendEmailSchema>> {
  // Get current user using SDK import
  // const user = getCurrentUser()

  // Log the execution
  console.log('Sending email', {
    to: input.to,
    subject: input.subject,
    priority: input.priority,
  })

  // Check if we have a connection (if your email service requires it)
  const connection = getUserConnection()
  if (!connection) {
    // For this example, we'll continue without a connection
    // In a real implementation, you might require it:
    // throw new Error('Email connection required. Please connect your email service in settings.')
    console.log('No connection found, using demo mode')
  }

  // Example: Make an API call to send the email
  // In a real implementation, you'd call your email service API
  try {
    // Simulate API call
    // const response = await fetch('https://api.emailservice.com/v1/send', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${connection?.value}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     to: input.to,
    //     subject: input.subject,
    //     body: input.body,
    //     priority: input.priority,
    //     cc: input.sendCopy ? [user.email] : undefined,
    //   }),
    // })

    // For demo purposes, simulate success
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const sentAt = new Date().toISOString()

    console.log('Email sent successfully', {
      messageId,
      sentAt,
    })

    // Return typed output matching the schema
    return {
      messageId,
      status: 'sent',
      sentAt,
    }
  } catch (error) {
    console.log('Failed to send email', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    throw error
  }
}
