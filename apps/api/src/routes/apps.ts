// apps/api/src/routes/apps.ts

import { Hono } from 'hono'
import { database } from '@auxx/database'
import { authMiddleware } from '../middleware/auth'
import { requireScope } from '../middleware/scope'
import { successResponse, errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

const apps = new Hono<AppContext>()

// All app routes require authentication
apps.use('/*', authMiddleware)

/**
 * GET /api/v1/apps
 * List all apps for the authenticated developer
 */
apps.get('/', requireScope(['developer', 'apps:read']), async (c) => {
  const userId = c.get('userId')

  // Get developer account member for this user
  const member = await database.query.DeveloperAccountMember.findFirst({
    where: (members, { eq }) => eq(members.userId, userId),
    with: {
      developerAccount: {
        with: {
          apps: true,
        },
      },
    },
  })

  if (!member || !member.developerAccount) {
    return c.json(errorResponse('NOT_FOUND', 'Developer account not found'), 404)
  }

  return c.json(
    successResponse({
      apps: member.developerAccount.apps,
    })
  )
})

/**
 * GET /api/v1/apps/by-slug/:slug
 * Get app by slug
 */
apps.get('/by-slug/:slug', requireScope(['developer', 'apps:read']), async (c) => {
  const slug = c.req.param('slug')
  const userId = c.get('userId')

  // Get app with developer account member check
  const app = await database.query.App.findFirst({
    where: (apps, { eq }) => eq(apps.slug, slug),
    with: {
      developerAccount: {
        with: {
          members: {
            where: (members, { eq }) => eq(members.userId, userId),
          },
        },
      },
    },
  })

  if (!app) {
    return c.json(errorResponse('NOT_FOUND', `App with slug "${slug}" not found`), 404)
  }

  // Check if user is a member of the developer account
  if (!app.developerAccount.members || app.developerAccount.members.length === 0) {
    return c.json(errorResponse('FORBIDDEN', 'You do not have access to this app'), 403)
  }

  return c.json(
    successResponse({
      app,
    })
  )
})

export default apps
