// apps/api/src/routes/chat/index.ts

import { Hono } from 'hono'
import { chatUserJwtMiddleware } from '../../middleware/chat-jwt'
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
// `chatUserJwtMiddleware` runs after — it relies on `c.var.chat` to know
// which channel's signing keys to verify against, and writes the per-request
// JWT state onto `c.var.chatJwt`. Warn-only in v4 (phase 5 adds enforcement).
chatRoutes.use('/initialize/*', chatPassportMiddleware, chatUserJwtMiddleware)
chatRoutes.use('/threads/*', chatPassportMiddleware, chatUserJwtMiddleware)
chatRoutes.use('/attachments/*', chatPassportMiddleware, chatUserJwtMiddleware)
chatRoutes.use('/typing/*', chatPassportMiddleware, chatUserJwtMiddleware)
chatRoutes.use('/receipts/*', chatPassportMiddleware, chatUserJwtMiddleware)
chatRoutes.use('/visitor-info/*', chatPassportMiddleware, chatUserJwtMiddleware)
// `/pusher/auth` is form-encoded (Pusher's client posts `socket_id`/`channel_name`
// as application/x-www-form-urlencoded). The chat-jwt middleware can only read
// the JWT envelope from JSON bodies, so re-verifying here would always 401 on
// `users + enforced` channels. The passport mint already gates identity at
// session start, and the pusher-auth handler ACL-checks channels against the
// passport's visitorParticipantId — re-verifying per pusher-auth call adds no
// security and breaks the request shape.
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
