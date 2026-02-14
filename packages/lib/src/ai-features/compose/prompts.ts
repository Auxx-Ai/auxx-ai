// packages/lib/src/ai-features/compose/prompts.ts

import { AI_OPERATION, type AIOperation, type AIToneType } from './types'

/**
 * HTML formatting instructions for all operations
 */
const HTML_FORMATTING_INSTRUCTIONS = `

CRITICAL HTML FORMATTING RULES:
- Return content in valid HTML format
- Use <p> tags for paragraphs
- Use <ul> and <li> tags for unordered lists (bullet points)
- Use <ol> and <li> tags for ordered lists (numbered items)
- Preserve list structure from the original content
- NEVER use plain text dashes (-) or asterisks (*) for lists - always use proper HTML list tags
- Always wrap list items in proper <li> tags
- Each list item should be on its own line for clarity

Example of CORRECT list formatting:
<ul>
  <li>First item</li>
  <li>Second item</li>
  <li>Third item</li>
</ul>

Example of INCORRECT formatting (never do this):
<p>- First item
- Second item
- Third item</p>`

/**
 * System prompts for each operation
 */
export const SYSTEM_PROMPTS: Record<AIOperation, string> = {
  [AI_OPERATION.COMPOSE]: `You are an AI assistant helping to compose professional email responses. 
Based on the conversation context provided, generate a relevant and appropriate email response.
Keep the response concise, professional, and directly address the points in the conversation.

IMPORTANT INSTRUCTIONS:
- Return ONLY the email body content
- Do NOT include a subject line in your response
- Do NOT include any email signature (no sign-offs like "Best regards", "Sincerely", etc.)
- Do NOT include the sender's name at the end
- The response should end with the last sentence of the main content
- Format the response as clean HTML ready for the email body
${HTML_FORMATTING_INSTRUCTIONS}`,

  [AI_OPERATION.TONE]: `You are an AI assistant specialized in adjusting the tone of email messages.
Rewrite the provided email content to match the requested tone while preserving the original meaning.

IMPORTANT INSTRUCTIONS:
- Return ONLY the adjusted email body content
- Do NOT include a subject line
- Do NOT include any email signature or sign-offs
- Maintain the same structure but adjust the tone as requested
- Preserve any list formatting from the original
${HTML_FORMATTING_INSTRUCTIONS}`,

  [AI_OPERATION.TRANSLATE]: `You are a professional translator specializing in business communication.
Translate the provided email accurately while maintaining tone and context.

IMPORTANT INSTRUCTIONS:
- Return ONLY the translated email body content
- Do NOT include a subject line
- Do NOT include any email signature or sign-offs
- Preserve the original structure and formatting
- Maintain list structures exactly as they appear in the original
${HTML_FORMATTING_INSTRUCTIONS}`,

  [AI_OPERATION.FIX_GRAMMAR]: `You are a professional copy editor.
Correct grammar, spelling, punctuation, and syntax errors while maintaining the original tone.

IMPORTANT INSTRUCTIONS:
- Return ONLY the corrected email body content
- Do NOT include a subject line
- Do NOT add or modify any signatures or sign-offs
- Preserve the original structure and meaning
- Maintain all list formatting exactly as in the original
${HTML_FORMATTING_INSTRUCTIONS}`,

  [AI_OPERATION.EXPAND]: `You are an AI assistant helping to expand email content.
Add relevant context and explanations while maintaining the original tone.

IMPORTANT INSTRUCTIONS:
- FIRST validate that the input contains meaningful, coherent text
- If the input appears to be gibberish, random characters, or lacks coherent meaning:
  - Return exactly: "ERROR"
  - Do NOT generate any unrelated content
  - Do NOT attempt to expand nonsensical input
- For valid input, expand the content with relevant details while maintaining professionalism
- Return ONLY the expanded email body content
- Do NOT include a subject line
- Do NOT include any email signature or sign-offs
- Preserve and potentially expand on any lists in the original content
${HTML_FORMATTING_INSTRUCTIONS}`,

  [AI_OPERATION.SHORTEN]: `You are an AI assistant specializing in concise communication.
Condense the email to essential points while maintaining clarity.

IMPORTANT INSTRUCTIONS:
- FIRST validate that the input contains meaningful, coherent text
- If the input appears to be gibberish, random characters, or lacks coherent meaning:
  - Return exactly: "ERROR"
  - Do NOT generate any unrelated content
  - Do NOT attempt to shorten nonsensical input
- For valid input, condense to essential points while maintaining clarity
- Return ONLY the shortened email body content
- Do NOT include a subject line
- Do NOT include any email signature or sign-offs
- Keep only the essential information while maintaining clarity
- Preserve list structures but condense list items if needed
${HTML_FORMATTING_INSTRUCTIONS}`,
}

/**
 * Generate user prompts based on operation
 */
export function getUserPrompt(
  operation: AIOperation,
  content: string,
  options?: {
    tone?: AIToneType
    language?: string
    context?: {
      previousMessages?: string
      subject?: string
    }
  }
): string {
  // Always remind about HTML formatting when content is provided
  const htmlReminder = content
    ? '\n\nThe content provided is in HTML format. Analyze its structure and ensure your response maintains proper HTML formatting with appropriate tags.'
    : ''

  switch (operation) {
    case AI_OPERATION.COMPOSE:
      if (options?.context?.previousMessages) {
        return `Based on the following conversation, compose an appropriate response:
        
Previous Messages:
${options.context.previousMessages}

Original Subject: ${options.context.subject || 'Email Response'}

Generate a professional response. Remember to return ONLY the email body content without any subject line or signature. Use proper HTML formatting with <p> tags for paragraphs and <ul>/<ol> with <li> tags for any lists.${htmlReminder}`
      }
      return `Compose a professional email body about: ${options?.context?.subject || 'the topic'}. Return ONLY the body content without subject or signature. Use proper HTML formatting.${htmlReminder}`

    case AI_OPERATION.TONE:
      return `Rewrite this email to be ${options?.tone?.toLowerCase()}. Return ONLY the body content without adding any signature. The following content is in HTML format - preserve and maintain all HTML structure including lists:
      
${content}${htmlReminder}`

    case AI_OPERATION.TRANSLATE:
      return `Translate this email to ${options?.language}. Return ONLY the translated body content without adding any signature. The following content is in HTML format - preserve all HTML structure including lists:
      
${content}${htmlReminder}`

    case AI_OPERATION.FIX_GRAMMAR:
      return `Fix grammar and spelling in this email. Return ONLY the corrected body content without modifying any existing signature. The following content is in HTML format - preserve all HTML structure including lists:
      
${content}${htmlReminder}`

    case AI_OPERATION.EXPAND:
      return `Expand this email with more detail. Return ONLY the expanded body content without adding any signature. The following content is in HTML format - preserve and expand any lists using proper HTML formatting:
      
${content}${htmlReminder}`

    case AI_OPERATION.SHORTEN:
      return `Make this email more concise. Return ONLY the shortened body content without adding any signature. The following content is in HTML format - preserve list structures using proper HTML formatting:
      
${content}${htmlReminder}`

    default:
      return content
  }
}

/**
 * Format thread messages for context
 */
export function formatThreadContext(
  messages: Array<{
    content: string
    sender: string
    timestamp: Date
    type: 'sent' | 'received'
  }>,
  maxMessages: number = 5
): string {
  const recentMessages = messages.slice(-maxMessages)

  return recentMessages
    .map((msg) => {
      const direction = msg.type === 'sent' ? 'You' : msg.sender
      const time = msg.timestamp.toLocaleString()
      return `[${direction} - ${time}]:
${msg.content}
---`
    })
    .join('\n\n')
}

/**
 * Get complete prompt configuration
 */
export function getPrompt(
  operation: AIOperation,
  content: string,
  options?: {
    tone?: AIToneType
    language?: string
    context?: {
      previousMessages?: string
      subject?: string
    }
  }
): { system: string; user: string } {
  return {
    system: SYSTEM_PROMPTS[operation],
    user: getUserPrompt(operation, content, options),
  }
}
