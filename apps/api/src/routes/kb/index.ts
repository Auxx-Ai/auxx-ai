// apps/api/src/routes/kb/index.ts

import { Hono } from 'hono'
import { chatPassportMiddleware } from '../../middleware/chat-passport'
import { channelKey, ipKey, rateLimit } from '../../middleware/rate-limit'
import articlesRoute from './articles'
import searchRoute from './search'
import treeRoute from './tree'

const kbRoutes = new Hono()

const minute = 60_000

// All KB visitor surfaces require a chat passport. CORS is applied per-route
// so the OPTIONS preflight still succeeds without the Authorization header.
kbRoutes.use('/tree', chatPassportMiddleware)
kbRoutes.use('/articles/*', chatPassportMiddleware)
kbRoutes.use('/search', chatPassportMiddleware)

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
kbRoutes.use(
  '/search',
  rateLimit([
    { name: 'kb:search:ip', maxRequests: 120, perInterval: minute, key: ipKey },
    { name: 'kb:search:channel', maxRequests: 1200, perInterval: minute, key: channelKey },
  ])
)

kbRoutes.route('/tree', treeRoute)
kbRoutes.route('/articles', articlesRoute)
kbRoutes.route('/search', searchRoute)

export default kbRoutes
