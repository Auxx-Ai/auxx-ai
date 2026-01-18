// // packages/lib/src/resources/crud/handlers/contact-handler.ts

// import * as contactDb from '@auxx/services/contacts'
// import type { UpdateContactInput } from '@auxx/services/contacts'
// import { toRecordId } from '@auxx/types/resource'
// import { publisher } from '../../../events'
// import type {
//   ContactCreatedEvent,
//   ContactUpdatedEvent,
//   ContactDeletedEvent,
// } from '../../../events/types'
// import type { ResourceHandler } from './types'
// import type { CrudResult, CrudContext, TransformedData } from '../types'
// import { trackChanges, type FieldChange } from '../utils/change-tracker'
// import { setCustomFields } from '../utils/custom-fields'
// import { parseTags } from '../utils/parse-tags'

// /** Fields to track changes for in contact events */
// const TRACKED_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'notes', 'status']

// /**
//  * Contact CRUD handler.
//  * Calls @auxx/services/contacts for DB operations.
//  * Publishes events after successful operations.
//  */
// export const contactHandler: ResourceHandler = {
//   supports: (resourceType) => resourceType === 'contact',

//   async create(data: TransformedData, ctx: CrudContext): Promise<CrudResult> {
//     const { standardFields, customFields } = data
//     const { organizationId, userId } = ctx

//     // Check for existing contact by email (dedup)
//     if (standardFields.email) {
//       const existingResult = await contactDb.findContactByEmail({
//         email: standardFields.email as string,
//         organizationId,
//       })
//       if (existingResult.isOk() && existingResult.value) {
//         return { success: true, id: existingResult.value.id, record: existingResult.value }
//       }
//     }

//     // Insert contact
//     const result = await contactDb.insertContact({
//       organizationId,
//       email: standardFields.email as string,
//       emails: standardFields.email ? [standardFields.email as string] : [],
//       firstName: standardFields.firstName as string | undefined,
//       lastName: standardFields.lastName as string | undefined,
//       phone: standardFields.phone as string | undefined,
//       notes: standardFields.notes as string | undefined,
//       tags: parseTags(standardFields.tags),
//     })

//     if (result.isErr()) {
//       return { success: false, error: result.error.message }
//     }

//     const contact = result.value!

//     // Set custom fields in batch
//     if (Object.keys(customFields).length > 0) {
//       const recordId = toRecordId('contact', contact.id)
//       await setCustomFields(recordId, customFields, ctx)
//     }

//     // Publish event
//     if (!ctx.skipEvents) {
//       await publisher.publishLater({
//         type: 'contact:created',
//         data: {
//           contactId: contact.id,
//           organizationId,
//           userId,
//           firstName: contact.firstName ?? undefined,
//           lastName: contact.lastName ?? undefined,
//           email: contact.email ?? '',
//         },
//       } as ContactCreatedEvent)
//     }

//     return { success: true, id: contact.id, record: contact }
//   },

//   async update(id: string, data: TransformedData, ctx: CrudContext): Promise<CrudResult> {
//     const { standardFields, customFields } = data
//     const { organizationId, userId } = ctx

//     // Only fetch old record if we need change tracking for events
//     let changes: FieldChange[] = []
//     if (!ctx.skipEvents) {
//       const existingResult = await contactDb.getContactById({
//         contactId: id,
//         organizationId,
//       })
//       if (existingResult.isOk() && existingResult.value) {
//         changes = trackChanges(existingResult.value, standardFields, TRACKED_FIELDS)
//       }
//     }

//     // Build update payload - only include defined fields
//     const updatePayload: contactDb.UpdateContactInput = {
//       id,
//       organizationId,
//     }

//     if (standardFields.firstName !== undefined)
//       updatePayload.firstName = standardFields.firstName as string
//     if (standardFields.lastName !== undefined)
//       updatePayload.lastName = standardFields.lastName as string
//     if (standardFields.email !== undefined) updatePayload.email = standardFields.email as string
//     if (standardFields.phone !== undefined) updatePayload.phone = standardFields.phone as string
//     if (standardFields.notes !== undefined) updatePayload.notes = standardFields.notes as string
//     if (standardFields.tags !== undefined) updatePayload.tags = parseTags(standardFields.tags)
//     if (standardFields.status !== undefined) updatePayload.status = standardFields.status as string

//     // Update contact
//     const result = await contactDb.updateContact(updatePayload)

//     if (result.isErr()) {
//       const code = result.error.code
//       if (code === 'CONTACT_NOT_FOUND') {
//         return { success: false, error: `Contact ${id} not found`, errorCode: 'NOT_FOUND' }
//       }
//       return { success: false, error: result.error.message }
//     }

//     // Set custom fields in batch
//     if (Object.keys(customFields).length > 0) {
//       const recordId = toRecordId('contact', id)
//       await setCustomFields(recordId, customFields, ctx)
//     }

//     // Publish event if changes occurred
//     if (!ctx.skipEvents && changes.length > 0) {
//       await publisher.publishLater({
//         type: 'contact:updated',
//         data: { contactId: id, organizationId, userId, changes },
//       } as ContactUpdatedEvent)
//     }

//     return { success: true, id, record: result.value }
//   },

//   async delete(id: string, ctx: CrudContext): Promise<CrudResult> {
//     const { db, organizationId, userId } = ctx

//     // Verify exists
//     const existingResult = await contactDb.getContactForDeletion({
//       contactId: id,
//       organizationId,
//     })

//     if (existingResult.isErr()) {
//       const code = existingResult.error.code
//       if (code === 'CONTACT_NOT_FOUND') {
//         return { success: false, error: `Contact ${id} not found`, errorCode: 'NOT_FOUND' }
//       }
//       return { success: false, error: existingResult.error.message }
//     }

//     // Delete with relations (in transaction)
//     const result = await db.transaction(async (tx) => {
//       return contactDb.deleteContactWithRelations(tx, id, organizationId)
//     })

//     if (result.length === 0) {
//       return { success: false, error: 'Delete failed' }
//     }

//     // Publish event
//     if (!ctx.skipEvents) {
//       await publisher.publishLater({
//         type: 'contact:deleted',
//         data: { contactId: id, organizationId, userId },
//       } as ContactDeletedEvent)
//     }

//     return { success: true, id }
//   },

//   async findByField(fieldKey: string, value: string, ctx: CrudContext): Promise<string | null> {
//     if (fieldKey === 'email') {
//       const result = await contactDb.findContactByEmail({
//         email: value,
//         organizationId: ctx.organizationId,
//       })
//       return result.isOk() && result.value ? result.value.id : null
//     }
//     return null
//   },
// }
