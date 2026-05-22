// apps/api/src/routes/chat/index.ts

import { Hono } from 'hono'
import { chatPassportMiddleware } from '../../middleware/chat-passport'
import { channelKey, ipKey, rateLimit, visitorThreadKey } from '../../middleware/rate-limit'
import attachmentsRoute from './attachments'
import configRoute from './config'
import initializeRoute from './initialize'
import passportRoute from './passport'
import pusherAuthRoute from './pusher-auth'
import receiptsRoute from './receipts'
import threadsRoute from './threads'
import typingRoute from './typing'
import visitorInfoRoute from './visitor-info'

const chatRoutes = new Hono()

const minute = 60_000

// Public surfaces — no passport required. Passport route owns its own limiter.
chatRoutes.route('/config', configRoute)
chatRoutes.route('/passport', passportRoute)

// Everything below requires a chat passport. Mount the passport middleware
// first so the rate-limit keys can read `c.var.chat.channelId` etc.
chatRoutes.use('/initialize/*', chatPassportMiddleware)
chatRoutes.use('/threads/*', chatPassportMiddleware)
chatRoutes.use('/attachments/*', chatPassportMiddleware)
chatRoutes.use('/typing/*', chatPassportMiddleware)
chatRoutes.use('/receipts/*', chatPassportMiddleware)
chatRoutes.use('/visitor-info/*', chatPassportMiddleware)
chatRoutes.use('/pusher/*', chatPassportMiddleware)

// /initialize — POST per page-load.
chatRoutes.use(
  '/initialize',
  rateLimit([
    { name: 'chat:init:ip', maxRequests: 30, perInterval: minute, key: ipKey },
    { name: 'chat:init:channel', maxRequests: 300, perInterval: minute, key: channelKey },
  ])
)

// /threads — collection: POST creates a new thread, GET lists.
chatRoutes.use(
  '/threads',
  rateLimit([
    {
      name: 'chat:thread-create:ip',
      maxRequests: 10,
      perInterval: minute,
      methods: ['POST'],
      key: ipKey,
    },
    {
      name: 'chat:thread-create:channel',
      maxRequests: 100,
      perInterval: minute,
      methods: ['POST'],
      key: channelKey,
    },
    {
      name: 'chat:thread-list:ip',
      maxRequests: 60,
      perInterval: minute,
      methods: ['GET'],
      key: ipKey,
    },
  ])
)
chatRoutes.use(
  '/threads/recent',
  rateLimit([{ name: 'chat:thread-recent:ip', maxRequests: 60, perInterval: minute, key: ipKey }])
)

// /threads/:threadId/messages — GET reads history; POST sends a message and
// may enqueue an AI agent run, so it's the strictest.
chatRoutes.use(
  '/threads/:threadId/messages',
  rateLimit([
    {
      name: 'chat:msg-history:ip',
      maxRequests: 60,
      perInterval: minute,
      methods: ['GET'],
      key: ipKey,
    },
    {
      name: 'chat:msg-send:ip',
      maxRequests: 30,
      perInterval: minute,
      methods: ['POST'],
      key: ipKey,
    },
    {
      name: 'chat:msg-send:channel',
      maxRequests: 600,
      perInterval: minute,
      methods: ['POST'],
      key: channelKey,
    },
    {
      name: 'chat:msg-send:thread',
      maxRequests: 20,
      perInterval: minute,
      methods: ['POST'],
      key: visitorThreadKey,
    },
  ])
)

chatRoutes.use(
  '/threads/:threadId/transcript',
  rateLimit([{ name: 'chat:transcript:ip', maxRequests: 5, perInterval: minute, key: ipKey }])
)

// /attachments — S3 + media-asset pipeline; keep tighter than text.
chatRoutes.use(
  '/attachments',
  rateLimit([
    { name: 'chat:upload:ip', maxRequests: 20, perInterval: minute, key: ipKey },
    { name: 'chat:upload:channel', maxRequests: 200, perInterval: minute, key: channelKey },
  ])
)

// /typing + /receipts — high-frequency by design. Trim only abusive bursts.
chatRoutes.use(
  '/typing',
  rateLimit([{ name: 'chat:typing:ip', maxRequests: 120, perInterval: minute, key: ipKey }])
)
chatRoutes.use(
  '/receipts/*',
  rateLimit([{ name: 'chat:receipts:ip', maxRequests: 120, perInterval: minute, key: ipKey }])
)

chatRoutes.use(
  '/visitor-info',
  rateLimit([{ name: 'chat:visitor-info:ip', maxRequests: 30, perInterval: minute, key: ipKey }])
)

chatRoutes.use(
  '/pusher/*',
  rateLimit([{ name: 'chat:pusher-auth:ip', maxRequests: 60, perInterval: minute, key: ipKey }])
)

chatRoutes.route('/initialize', initializeRoute)
chatRoutes.route('/threads', threadsRoute)
chatRoutes.route('/attachments', attachmentsRoute)
chatRoutes.route('/typing', typingRoute)
chatRoutes.route('/receipts', receiptsRoute)
chatRoutes.route('/visitor-info', visitorInfoRoute)
chatRoutes.route('/pusher/auth', pusherAuthRoute)

export default chatRoutes
