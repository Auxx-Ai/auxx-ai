/**
 * Built-in contact field types for core Contact model fields
 * These are separate from the ContactFieldType enum in the database
 */
export const BUILT_IN_FIELD_TYPES = {
  READ_ONLY_DATE: 'READ_ONLY_DATE',
  CONTACT_STATUS: 'CONTACT_STATUS',
  CONTACT_EMAIL: 'CONTACT_EMAIL',
  CONTACT_NAME: 'CONTACT_NAME',
  CONTACT_PHONE: 'CONTACT_PHONE',
  CONTACT_GROUPS: 'CONTACT_GROUPS',
} as const

export type BuiltInFieldType = (typeof BUILT_IN_FIELD_TYPES)[keyof typeof BUILT_IN_FIELD_TYPES]
