// apps/web/src/server/api/calendar-day-schema.ts

import { z } from 'zod'

/** A calendar day, `YYYY-MM-DD`; the lib resolves it in `accounting.bookTimeZone`. */
export const calendarDaySchema = z.iso.date({ error: 'Expected YYYY-MM-DD' })
