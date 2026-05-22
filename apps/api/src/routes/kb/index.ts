// apps/api/src/routes/kb/index.ts

import { Hono } from 'hono'
import { chatPassportMiddleware } from '../../middleware/chat-passport'
import { channelKey, ipKey, rateLimit } from '../../middleware/rate-limit'
import articlesRoute from './articles'
import treeRoute from './tree'

const kbRoutes = new Hono()

const minute = 60_000

// All KB visitor surfaces require a chat passport. CORS is applied per-route
// so the OPTIONS preflight still succeeds without the Authorization header.
kbRoutes.use('/tree', chatPassportMiddleware)
kbRoutes.use('/articles/*', chatPassportMiddleware)

kbRoutes.use(
  '/tree',
  rateLimit([
    { name: 'kb:tree:ip', maxRequests: 60, perInterval: minute, key: ipKey },
    { name: 'kb:tree:channel', maxRequests: 600, perInterval: minute, key: channelKey },
  ])
)
kbRoutes.use(
  '/articles/*',
  rateLimit([{ name: 'kb:article:ip', maxRequests: 60, perInterval: minute, key: ipKey }])
)

kbRoutes.route('/tree', treeRoute)
kbRoutes.route('/articles', articlesRoute)

export default kbRoutes
