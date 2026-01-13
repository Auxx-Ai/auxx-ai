// packages/services/src/contacts/index.ts

// Query operations
export {
  searchContacts,
  getAllContacts,
  getContactById,
  getContactsByIds,
  getTicketCountsForContacts,
  getRecentTickets,
  findContactByEmail,
  getCustomFieldsForContacts,
  getCustomFieldValuesForContacts,
} from './contact-queries'

// Mutation operations
export {
  insertContact,
  insertCustomerSource,
  updateContact,
  updateContactStatus,
  deleteContactWithRelations,
  getContactForDeletion,
} from './contact-mutations'

// Bulk operations
export { bulkUpdate, bulkUpdateToSpam, bulkDeleteContacts } from './contact-bulk'

// Customer group operations
export {
  getCustomerGroups,
  getCustomerGroupById,
  checkGroupNameExists,
  insertCustomerGroup,
  updateCustomerGroup,
  deleteCustomerGroup,
  addContactsToGroup,
  removeContactsFromGroup,
  getGroupsForContacts,
} from './customer-groups'

// Types
export type {
  ContactContext,
  ContactCursor,
  SearchContactsInput,
  GetAllContactsInput,
  InsertContactInput,
  InsertCustomerSourceInput,
  UpdateContactInput,
} from './types'

// Errors
export type {
  ContactError,
  ContactNotFoundError,
  CustomerGroupNotFoundError,
  CustomerGroupAlreadyExistsError,
} from './errors'
