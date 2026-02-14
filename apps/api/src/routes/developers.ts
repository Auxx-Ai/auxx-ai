// apps/api/src/routes/developers.ts

import { database, schema } from '@auxx/database'
// import { listUserOrganizations } from '../services/organization-members'
import { listUserOrganizations } from '@auxx/services/organization-members'
import { Hono } from 'hono'
import { type ErrorStatusCode, errorResponse, successResponse } from '../lib/response'
import { authMiddleware } from '../middleware/auth'
import { requireScope } from '../middleware/scope'
import type { AppContext } from '../types/context'

const developers = new Hono<AppContext>()

// All developer routes require authentication
developers.use('/*', authMiddleware)

/**
 * GET /api/v1/developers/me
 * Get current authenticated developer information
 */
developers.get('/me', requireScope(['developer']), async (c) => {
  const userId = c.get('userId')

  // Get developer account member for this user
  const member = await database.query.DeveloperAccountMember.findFirst({
    where: (members, { eq }) => eq(members.userId, userId),
    with: {
      developerAccount: true,
    },
  })

  if (!member || !member.developerAccount) {
    return c.json(
      errorResponse('NOT_FOUND', 'Developer account not found. Please create one first.'),
      404
    )
  }

  return c.json(
    successResponse({
      developer: {
        ...member.developerAccount,
        memberAccessLevel: member.accessLevel,
        memberCreatedAt: member.createdAt,
      },
    })
  )
})

/**
 * POST /api/v1/developers
 * Create a new developer account for the authenticated user
 */
developers.post('/', requireScope(['developer']), async (c) => {
  const userId = c.get('userId')
  const user = c.get('user')

  // Check if developer account already exists for this user
  const existingMember = await database.query.DeveloperAccountMember.findFirst({
    where: (members, { eq }) => eq(members.userId, userId),
  })

  if (existingMember) {
    return c.json(errorResponse('CONFLICT', 'Developer account already exists'), 409)
  }

  // Create developer account
  const [account] = await database
    .insert(schema.DeveloperAccount)
    .values({
      slug: `dev-${Date.now()}`, // Generate temporary slug
      title: user.name || user.email || 'Developer Account',
      updatedAt: new Date(),
    })
    .returning()

  if (!account) {
    return c.json(errorResponse('INTERNAL_ERROR', 'Failed to create developer account'), 500)
  }

  // Create admin membership for current user
  const [member] = await database
    .insert(schema.DeveloperAccountMember)
    .values({
      developerAccountId: account.id,
      userId: userId,
      emailAddress: user.email!,
      accessLevel: 'admin',
      updatedAt: new Date(),
    })
    .returning()

  if (!member) {
    return c.json(errorResponse('INTERNAL_ERROR', 'Failed to create membership'), 500)
  }

  return c.json(
    successResponse({
      developer: {
        ...account,
        memberAccessLevel: member.accessLevel,
        memberCreatedAt: member.createdAt,
      },
    }),
    201
  )
})

/**
 * GET /api/v1/developers/dev-organizations
 * List all organizations the authenticated user can access for app development/testing
 */
developers.get('/dev-organizations', requireScope(['developer']), async (c) => {
  const userId = c.get('userId')

  // Get user organizations
  const result = await listUserOrganizations({ userId })
  if (result.isErr()) {
    const error = result.error
    const statusCode: ErrorStatusCode = 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  return c.json({ organizations: result.value })
})

export default developers
