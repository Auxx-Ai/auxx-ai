// packages/sdk/__fixtures__/fields-app/src/app.ts
//
// Unannotated `app` export (NOT `: App`) so the field literals survive on
// `typeof app['fields']` — the generated `.auxx/app-fields.d.ts` reads them.

import { fields } from './fields'

export const app = {
  fields,
}
