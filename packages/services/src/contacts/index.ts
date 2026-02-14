// packages/services/src/contacts/index.ts

// Bulk operations
export { bulkDeleteContacts, bulkUpdate, bulkUpdateToSpam } from './contact-bulk'

// Mutation operations
export {
  deleteContactWithRelations,
  getContactForDeletion,
  insertContact,
  insertCustomerSource,
  updateContact,
  updateContactStatus,
} from './contact-mutations'
// Query operations
export {
  findContactByEmail,
  getAllContacts,
  getContactById,
  getContactsByIds,
  getCustomFieldsForContacts,
  getCustomFieldValuesForContacts,
  getRecentTickets,
  getTicketCountsForContacts,
  searchContacts,
} from './contact-queries'

// Customer group operations
export {
  addContactsToGroup,
  checkGroupNameExists,
  deleteCustomerGroup,
  getCustomerGroupById,
  getCustomerGroups,
  getGroupsForContacts,
  insertCustomerGroup,
  removeContactsFromGroup,
  updateCustomerGroup,
} from './customer-groups'
// Errors
export type {
  ContactError,
  ContactNotFoundError,
  CustomerGroupAlreadyExistsError,
  CustomerGroupNotFoundError,
} from './errors'
// Types
export type {
  ContactContext,
  ContactCursor,
  GetAllContactsInput,
  InsertContactInput,
  InsertCustomerSourceInput,
  SearchContactsInput,
  UpdateContactInput,
} from './types'
