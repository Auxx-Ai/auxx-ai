// packages/services/src/contacts/errors.ts

/**
 * Contact not found error
 */
export type ContactNotFoundError = {
  code: 'CONTACT_NOT_FOUND'
  message: string
  contactId?: string
}

/**
 * Customer group not found error
 */
export type CustomerGroupNotFoundError = {
  code: 'CUSTOMER_GROUP_NOT_FOUND'
  message: string
  groupId: string
}

/**
 * Customer group already exists error
 */
export type CustomerGroupAlreadyExistsError = {
  code: 'CUSTOMER_GROUP_ALREADY_EXISTS'
  message: string
  name: string
}

/**
 * All contact-specific errors
 */
export type ContactError =
  | ContactNotFoundError
  | CustomerGroupNotFoundError
  | CustomerGroupAlreadyExistsError
