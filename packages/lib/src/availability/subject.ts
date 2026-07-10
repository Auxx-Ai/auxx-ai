// packages/lib/src/availability/subject.ts
//
// Maps an `AvailabilitySubject` to `OperatingHours` WHERE predicates / insert columns.
// Every query and mutation in this module goes through these two functions — the single
// place that decides which rows belong to which subject.

import { schema } from '@auxx/database'
import { and, eq, type SQL } from 'drizzle-orm'
import type { AvailabilitySubject } from './types'

/** WHERE predicate scoping `OperatingHours` rows to `subject` (org/widget/user columns). */
export function subjectConditions(subject: AvailabilitySubject): SQL {
  switch (subject.type) {
    case 'organization':
      return and(
        eq(schema.OperatingHours.organizationId, subject.organizationId),
        eq(schema.OperatingHours.subjectType, 'organization')
      )!
    case 'worker':
      return and(
        eq(schema.OperatingHours.organizationId, subject.organizationId),
        eq(schema.OperatingHours.subjectType, 'worker'),
        eq(schema.OperatingHours.userId, subject.userId)
      )!
    case 'widget':
      return and(
        eq(schema.OperatingHours.organizationId, subject.organizationId),
        eq(schema.OperatingHours.subjectType, 'widget'),
        eq(schema.OperatingHours.widgetId, subject.widgetId)
      )!
  }
}

/** The subject-identifying columns to stamp on every inserted `OperatingHours` row. */
export function subjectColumns(subject: AvailabilitySubject): {
  organizationId: string
  subjectType: 'organization' | 'worker' | 'widget'
  widgetId: string | null
  userId: string | null
} {
  switch (subject.type) {
    case 'organization':
      return {
        organizationId: subject.organizationId,
        subjectType: 'organization',
        widgetId: null,
        userId: null,
      }
    case 'worker':
      return {
        organizationId: subject.organizationId,
        subjectType: 'worker',
        widgetId: null,
        userId: subject.userId,
      }
    case 'widget':
      return {
        organizationId: subject.organizationId,
        subjectType: 'widget',
        widgetId: subject.widgetId,
        userId: null,
      }
  }
}
