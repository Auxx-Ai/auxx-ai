#!/usr/bin/env tsx

// scripts/rename-system-users.ts

/**
 * One-shot data fix: rename existing system users to "Auxx.ai".
 *
 * Historically system users were seeded as "<Org> AI Assistant". The current
 * seeder creates them as "Auxx.ai" — this script aligns existing rows.
 *
 * Run with:
 *   npx dotenv -- npx tsx scripts/rename-system-users.ts
 *
 * Delete this script after it has been executed in dev + prod.
 */

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

const NEW_NAME = 'Auxx.ai'

async function main() {
  const updated = await database
    .update(schema.User)
    .set({ name: NEW_NAME, updatedAt: new Date() })
    .where(eq(schema.User.userType, 'SYSTEM'))
    .returning({ id: schema.User.id, name: schema.User.name })

  console.log(`Renamed ${updated.length} system users to "${NEW_NAME}"`)
  for (const user of updated) {
    console.log(`  - ${user.id}: ${user.name}`)
  }

  // Invalidate Redis caches so the new name is picked up immediately.
  try {
    const { getRedisClient } = await import('@auxx/redis')
    const redis = await getRedisClient(false)
    if (redis) {
      const keys = await redis.keys('system-user:org:*')
      if (keys.length > 0) {
        await redis.del(...keys)
        console.log(`Cleared ${keys.length} system-user cache entries`)
      }
    }
  } catch (err) {
    console.warn('Redis cache invalidation skipped:', err)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('Failed to rename system users:', err)
  process.exit(1)
})
