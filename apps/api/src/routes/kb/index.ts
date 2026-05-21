// apps/api/src/routes/kb/index.ts

import { Hono } from 'hono'
import { chatPassportMiddleware } from '../../middleware/chat-passport'
import articlesRoute from './articles'
import treeRoute from './tree'

const kbRoutes = new Hono()

// All KB visitor surfaces require a chat passport. CORS is applied per-route
// so the OPTIONS preflight still succeeds without the Authorization header.
kbRoutes.use('/tree', chatPassportMiddleware)
kbRoutes.use('/articles/*', chatPassportMiddleware)

kbRoutes.route('/tree', treeRoute)
kbRoutes.route('/articles', articlesRoute)

export default kbRoutes
