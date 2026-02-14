// packages/database/src/tests/user-model.test.ts

import { desc } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { UserModel } from '../db/models/user'
import { User } from '../db/schema/user'

const HAS_DB = !!process.env.DATABASE_URL

describe('UserModel', () => {
  it.skipIf(!HAS_DB)('findFirst should run and not throw', async () => {
    const model = new UserModel()
    const res = await model.findFirst({ orderBy: desc(User.createdAt) })
    expect(res.ok).toBe(true)
  })

  it.skipIf(!HAS_DB)('findByEmail returns null for non-existent', async () => {
    const model = new UserModel()
    const res = await model.findByEmail('this-email-should-not-exist@example.com')
    expect(res.ok).toBe(true)
    expect(res.ok && res.value === null).toBe(true)
  })

  it.skipIf(!HAS_DB)('create, update, delete user roundtrip', async () => {
    const model = new UserModel()
    const id = `test_user_${Date.now()}`
    const email = `${id}@example.com`
    // Create
    const created = await model.create({ id, email, name: 'Temp User' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.id).toBe(id)
    expect(created.value.email).toBe(email)

    // Update
    const updated = await model.update(id, { name: 'Updated User' })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value.name).toBe('Updated User')

    // Delete
    const deleted = await model.delete(id)
    expect(deleted.ok).toBe(true)

    // Verify gone
    const fetched = await model.findById(id)
    expect(fetched.ok).toBe(true)
    if (!fetched.ok) return
    expect(fetched.value).toBeNull()
  })
})
