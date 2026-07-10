// apps/worker/scripts/verify-dispatch-m1.ts
/**
 * Dispatch M1 end-to-end verification (plans/dispatch/03-m1-records.md §J.7).
 * Exercises the REAL write paths: UnifiedCrudHandler.create (number pre-hooks +
 * visit auto-create field-change hook), concurrent creates (sequence race fix),
 * convertRequestToWorkOrder (primary intake), createWorkOrderFromTicket
 * (secondary intake), and the F.4b manual-`converted` guard.
 *
 * Creates records prefixed "[M1-verify]" and deletes them at the end.
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-dispatch-m1.ts
 */

import { database } from '@auxx/database'
import { convertRequestToWorkOrder, createWorkOrderFromTicket } from '@auxx/lib/dispatch'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`, detail ?? '')
  }
}

async function getVisits(workOrderInstanceId: string) {
  return database.query.WorkOrderVisit.findMany({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
  })
}

async function entityDefId(organizationId: string, entityType: string) {
  const def = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, entityType)),
  })
  return def?.id ?? null
}

async function fieldValueByAttr(
  organizationId: string,
  entityType: 'work_order' | 'service_request',
  instanceId: string,
  systemAttribute: string
) {
  const defId = await entityDefId(organizationId, entityType)
  if (!defId) return null
  const field = await database.query.CustomField.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.entityDefinitionId, defId), eq(t.systemAttribute, systemAttribute)),
  })
  if (!field) return null
  const fv = await database.query.FieldValue.findFirst({
    where: (t, { and, eq }) => and(eq(t.entityId, instanceId), eq(t.fieldId, field.id)),
  })
  return fv ?? null
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []

  // ── A: plain work order create → number hook + visit auto-create ──
  console.log('A: work order create')
  const wo1 = await handler.create('work_order', {
    work_order_title: '[M1-verify] WO one',
  })
  createdRecordIds.push(wo1.recordId)
  const wo1Number = await fieldValueByAttr(
    organizationId,
    'work_order',
    wo1.instance.id,
    'work_order_number'
  )
  check(`number auto-assigned (${wo1Number?.valueText})`, !!wo1Number?.valueText?.startsWith('WO-'))
  const wo1Visits = await getVisits(wo1.instance.id)
  check(
    'visit row auto-created (unscheduled)',
    wo1Visits.length === 1 &&
      wo1Visits[0]!.startTime === null &&
      wo1Visits[0]!.status === 'scheduled',
    wo1Visits
  )

  // ── B: concurrent creates → distinct sequential numbers ──
  console.log('B: concurrent creates (race fix)')
  const [wo2, wo3] = await Promise.all([
    handler.create('work_order', { work_order_title: '[M1-verify] WO two' }),
    handler.create('work_order', { work_order_title: '[M1-verify] WO three' }),
  ])
  createdRecordIds.push(wo2.recordId, wo3.recordId)
  const n2 = await fieldValueByAttr(
    organizationId,
    'work_order',
    wo2.instance.id,
    'work_order_number'
  )
  const n3 = await fieldValueByAttr(
    organizationId,
    'work_order',
    wo3.instance.id,
    'work_order_number'
  )
  check(
    `distinct numbers (${n2?.valueText} vs ${n3?.valueText})`,
    !!n2?.valueText && !!n3?.valueText && n2.valueText !== n3.valueText
  )

  // ── B2: recurring jobType still creates exactly ONE visit ──
  const woRec = await handler.create('work_order', {
    work_order_title: '[M1-verify] WO recurring',
    work_order_job_type: 'recurring',
  })
  createdRecordIds.push(woRec.recordId)
  const recVisits = await getVisits(woRec.instance.id)
  check('recurring jobType → exactly one visit', recVisits.length === 1, recVisits.length)

  // ── C: service request create → REQ number ──
  console.log('C: service request create')
  const contactDefId = await entityDefId(organizationId, 'contact')
  const contact = contactDefId
    ? await database.query.EntityInstance.findFirst({
        columns: { id: true },
        where: (t, { eq }) => eq(t.entityDefinitionId, contactDefId),
      })
    : null
  if (!contact) throw new Error('No contact in org — cannot test service request')
  const contactRecordId = `${contactDefId}:${contact.id}`

  const sr = await handler.create('service_request', {
    service_request_title: '[M1-verify] SR one',
    service_request_contact: contactRecordId,
  })
  createdRecordIds.push(sr.recordId)
  const srNumber = await fieldValueByAttr(
    organizationId,
    'service_request',
    sr.instance.id,
    'service_request_number'
  )
  check(
    `REQ number auto-assigned (${srNumber?.valueText})`,
    !!srNumber?.valueText?.startsWith('REQ-')
  )
  const srStatus = await fieldValueByAttr(
    organizationId,
    'service_request',
    sr.instance.id,
    'service_request_status'
  )
  check('status defaulted to new', srStatus?.optionId === 'new', srStatus?.optionId)

  // ── D: convert request → work order ──
  console.log('D: convertRequestToWorkOrder (primary intake)')
  const converted = await convertRequestToWorkOrder({
    organizationId,
    userId,
    requestInstanceId: sr.instance.id,
  })
  createdRecordIds.push(converted.recordId)
  const convVisits = await getVisits(converted.instance.id)
  check('converted WO has a visit row', convVisits.length === 1)
  const convRequestLink = await fieldValueByAttr(
    organizationId,
    'work_order',
    converted.instance.id,
    'work_order_request'
  )
  check('work_order_request links back to the request', convRequestLink?.relatedEntityId != null)
  const convContact = await fieldValueByAttr(
    organizationId,
    'work_order',
    converted.instance.id,
    'work_order_contact'
  )
  check('contact copied onto the WO', convContact?.relatedEntityId != null)
  const srStatusAfter = await fieldValueByAttr(
    organizationId,
    'service_request',
    sr.instance.id,
    'service_request_status'
  )
  check(
    'request status flipped to converted',
    srStatusAfter?.optionId === 'converted',
    srStatusAfter?.optionId
  )

  // ── E: manual `converted` write rejected; other statuses allowed ──
  console.log('E: F.4b guard')
  const sr2 = await handler.create('service_request', {
    service_request_title: '[M1-verify] SR two',
    service_request_contact: contactRecordId,
  })
  createdRecordIds.push(sr2.recordId)
  let guardThrew = false
  let guardMessage = ''
  try {
    await handler.update(sr2.recordId, { service_request_status: 'converted' })
  } catch (err) {
    guardThrew = true
    guardMessage = err instanceof Error ? err.message : String(err)
  }
  check(`manual converted write rejected ("${guardMessage}")`, guardThrew)
  await handler.update(sr2.recordId, { service_request_status: 'lost' })
  const sr2Status = await fieldValueByAttr(
    organizationId,
    'service_request',
    sr2.instance.id,
    'service_request_status'
  )
  check('manual lost write allowed', sr2Status?.optionId === 'lost', sr2Status?.optionId)

  // ── F: createFromTicket (secondary intake), if a ticket exists ──
  console.log('F: createWorkOrderFromTicket (secondary intake)')
  const ticketDefId = await entityDefId(organizationId, 'ticket')
  const ticket = ticketDefId
    ? await database.query.EntityInstance.findFirst({
        columns: { id: true },
        where: (t, { eq }) => eq(t.entityDefinitionId, ticketDefId),
      })
    : null
  if (ticket) {
    const fromTicket = await createWorkOrderFromTicket({
      organizationId,
      userId,
      ticketInstanceId: ticket.id,
    })
    createdRecordIds.push(fromTicket.recordId)
    const ftVisits = await getVisits(fromTicket.instance.id)
    const ftTicketLink = await fieldValueByAttr(
      organizationId,
      'work_order',
      fromTicket.instance.id,
      'work_order_ticket'
    )
    check(
      'ticket-sourced WO has visit + ticket link',
      ftVisits.length === 1 && ftTicketLink?.relatedEntityId != null
    )
  } else {
    console.log('  (no ticket in org — skipped)')
  }

  // ── Cleanup ──
  console.log(`Cleanup: deleting ${createdRecordIds.length} verify records`)
  for (const recordId of createdRecordIds.reverse()) {
    try {
      await handler.delete(recordId as never)
    } catch (err) {
      console.log(`  cleanup failed for ${recordId}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
