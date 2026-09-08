// packages/lib/scripts/add-dev-org-membership.ts
//
// DEV ONLY. Adds a user to an organization as OWNER so a developer can drive a
// seeded org in the browser.
//
// 🛑 There is no product reason for this script to exist: membership is granted
// by an invitation, and this bypasses that whole path. It exists because the
// seeded demo orgs and the seeded login user are not the same set - DemoOrg1
// carries the working books that every accounting browser pass drives against,
// and `markus@auxx.ai` (the account whose dev password is known) is not in it.
//
// Idempotent - a user who is already a member is left exactly as they are,
// role included.
//
//   npx dotenv -- npx tsx packages/lib/scripts/add-dev-org-membership.ts <email> <orgName>

import { closePools, database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../src/cache'

async function main() {
  const [email, orgName] = process.argv.slice(2)
  if (!email || !orgName) {
    console.error('usage: add-dev-org-membership.ts <email> <orgName>')
    process.exit(1)
  }

  const [user] = await database
    .select({ id: schema.User.id })
    .from(schema.User)
    .where(eq(schema.User.email, email))
  if (!user) throw new Error(`No user ${email}`)

  const [org] = await database
    .select({ id: schema.Organization.id })
    .from(schema.Organization)
    .where(eq(schema.Organization.name, orgName))
  if (!org) throw new Error(`No organization named ${orgName}`)

  const [existing] = await database
    .select({ id: schema.OrganizationMember.id, role: schema.OrganizationMember.role })
    .from(schema.OrganizationMember)
    .where(
      and(
        eq(schema.OrganizationMember.userId, user.id),
        eq(schema.OrganizationMember.organizationId, org.id)
      )
    )

  if (existing) {
    console.log(`${email} is already a member of ${orgName} as ${existing.role} - left alone`)
  } else {
    await database.insert(schema.OrganizationMember).values({
      userId: user.id,
      organizationId: org.id,
      role: 'OWNER',
      status: 'ACTIVE',
      updatedAt: new Date(),
    })
    // 🛑 The org cache is what `isMember` reads, and a direct INSERT fires no
    // event of its own - so without this the switcher answers "Not a member of
    // this organization" against a row that plainly exists.
    await onCacheEvent('member.added', { orgId: org.id, userId: user.id, broadcastUserKeys: true })
    console.log(`Added ${email} to ${orgName} as OWNER, and busted the member cache`)
  }

  await closePools()
  process.exit(0)
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})
