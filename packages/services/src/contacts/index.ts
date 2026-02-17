// packages/services/src/contacts/index.ts

// Query operations
export {
  findContactByEmail,
  getAllContacts,
  getContactById,
  getContactsByIds,
  getCustomFieldsForContacts,
  getCustomFieldValuesForContacts,
  searchContacts,
} from './contact-queries'

// Types
export type {
  ContactContext,
  ContactCursor,
  GetAllContactsInput,
  SearchContactsInput,
} from './types'
