// apps/worker/scripts/verify-money-mq2-snippets.ts
/**
 * Money MQ2 system-snippets verification (plans/dispatch/money/05-mq2-build.md §D.2-D.4).
 * Exercises the REAL get-or-create + guard paths against a real dev org:
 *   1. `getSystemSnippet(db, orgId, 'quote_email')` lazily materializes a row whose
 *      `contentHtml` embeds `data-type="placeholder"` spans keyed by the org's REAL
 *      `EntityDefinition.id` cuids for `quote` and `contact`.
 *   2. A second call returns the SAME row (idempotent get-or-create, no duplicate insert).
 *   3. `listSnippetsForUser` does NOT surface it (library/composer hiding).
 *   4. `updateSnippet` / `deleteSnippet` both throw Forbidden.
 *
 * Does not create/delete any lasting data beyond the (idempotent) system snippet row
 * itself, which is intentionally left in place — it's the real row `getSystemSnippet`
 * will keep reusing in the send flow.
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-mq2-snippets.ts
 */

import { database } from '@auxx/database'
import { ForbiddenError } from '@auxx/lib/errors'
import {
  deleteSnippet,
  getSystemSnippet,
  listSnippetsForUser,
  updateSnippet,
} from '@auxx/lib/snippets'

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

async function entityDefId(organizationId: string, entityType: string) {
  const def = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, entityType)),
  })
  return def?.id ?? null
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — MQ1 script's org)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const quoteDefId = await entityDefId(organizationId, 'quote')
  const contactDefId = await entityDefId(organizationId, 'contact')
  if (!quoteDefId || !contactDefId) throw new Error('quote/contact EntityDefinition missing in org')
  console.log(`quote defId=${quoteDefId}, contact defId=${contactDefId}`)

  // ── 1: get-or-create materializes with real def-id-keyed placeholder spans ──
  console.log('1: getSystemSnippet get-or-create')
  const snippet1 = await getSystemSnippet(database, organizationId, 'quote_email')
  check('systemType = quote_email', snippet1.systemType === 'quote_email')
  check(
    'contentHtml has placeholder spans',
    snippet1.contentHtml?.includes('data-type="placeholder"') ?? false
  )
  check(
    `contentHtml keyed by REAL quote defId (${quoteDefId})`,
    (snippet1.contentHtml ?? '').includes(`data-id="${quoteDefId}:`)
  )
  check(
    `contentHtml keyed by REAL contact defId (${contactDefId})`,
    (snippet1.contentHtml ?? '').includes(`data-id="${contactDefId}:firstName"`)
  )
  check(
    'contentHtml has NO other org/hardcoded def id (spot check quoteDefId used, not literal "quote")',
    !(snippet1.contentHtml ?? '').includes('data-id="quote:')
  )

  // ── 2: idempotent — second call returns the SAME row, no dupe ──
  console.log('2: idempotent second call')
  const snippet2 = await getSystemSnippet(database, organizationId, 'quote_email')
  check('second call returns same row id', snippet2.id === snippet1.id)

  const dupeCount = await database.query.Snippet.findMany({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.systemType, 'quote_email')),
  })
  check('exactly one quote_email row for the org', dupeCount.length === 1, dupeCount.length)

  // ── 3: hidden from listSnippetsForUser ──
  console.log('3: hidden from library list')
  // The OWNER scope (`exclude` with an empty list) is the widest a snippet list
  // can be — if the system snippet is invisible even here, the `systemType`
  // filter is doing the hiding, not the access scope.
  const listResult = await listSnippetsForUser(
    database,
    organizationId,
    userId,
    { kind: 'exclude', excludeIds: [] },
    { includeShared: true }
  )
  check('listSnippetsForUser succeeded', listResult.isOk())
  if (listResult.isOk()) {
    const found = listResult.value.find((s) => s.id === snippet1.id)
    check('system snippet NOT present in listSnippetsForUser', !found)
  }

  // ── 4: mutation guards throw Forbidden ──
  console.log('4: mutation guards')
  const updateResult = await updateSnippet(database, organizationId, snippet1.id, {
    title: 'hacked',
  })
  check(
    'updateSnippet returns err(ForbiddenError)',
    updateResult.isErr() && updateResult.error instanceof ForbiddenError,
    updateResult.isErr() ? updateResult.error.message : updateResult.value
  )

  const deleteResult = await deleteSnippet(database, organizationId, snippet1.id)
  check(
    'deleteSnippet returns err(ForbiddenError)',
    deleteResult.isErr() && deleteResult.error instanceof ForbiddenError,
    deleteResult.isErr() ? deleteResult.error.message : undefined
  )

  // Confirm the row genuinely survived the (rejected) delete attempt.
  const stillThere = await database.query.Snippet.findFirst({
    columns: { id: true, isDeleted: true },
    where: (t, { eq }) => eq(t.id, snippet1.id),
  })
  check(
    'row still present + not deleted after rejected deleteSnippet',
    stillThere?.isDeleted === false
  )

  console.log('\n--- contentHtml (for review) ---')
  console.log(snippet1.contentHtml)
  console.log('--- content (plain text) ---')
  console.log(snippet1.content)
  console.log('--- title (subject) ---')
  console.log(snippet1.title)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
