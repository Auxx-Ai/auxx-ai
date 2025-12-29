// packages/seed/src/generators/conversation.generator.ts
// Helpers for generating structured conversation flows during seeding

import { ContentGenerator } from './content.generator'

/** ConversationGenerator creates synthetic support conversations. */
export class ConversationGenerator {
  /**
   * supportTicket returns a list of alternating customer/agent messages.
   * @param theme - Conversation theme used to select templates.
   * @returns Sequence of message bodies portraying a conversation.
   */
  static supportTicket(theme: 'order' | 'product' | 'return' | 'billing'): string[] {
    return ContentGenerator.supportConversation(theme)
  }
}
