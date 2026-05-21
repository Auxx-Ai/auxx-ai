// apps/api/src/routes/chat/index.ts

import { Hono } from 'hono'
import { chatPassportMiddleware } from '../../middleware/chat-passport'
import attachmentsRoute from './attachments'
import configRoute from './config'
import initializeRoute from './initialize'
import messagesRoute from './messages'
import passportRoute from './passport'
import receiptsRoute from './receipts'
import threadsRoute from './threads'
import typingRoute from './typing'
import visitorInfoRoute from './visitor-info'

const chatRoutes = new Hono()

// Public surfaces — no passport required.
chatRoutes.route('/config', configRoute)
chatRoutes.route('/passport', passportRoute)

// Everything below requires a chat passport.
chatRoutes.use('/initialize/*', chatPassportMiddleware)
chatRoutes.use('/messages/*', chatPassportMiddleware)
chatRoutes.use('/threads/*', chatPassportMiddleware)
chatRoutes.use('/attachments/*', chatPassportMiddleware)
chatRoutes.use('/typing/*', chatPassportMiddleware)
chatRoutes.use('/receipts/*', chatPassportMiddleware)
chatRoutes.use('/visitor-info/*', chatPassportMiddleware)

chatRoutes.route('/initialize', initializeRoute)
chatRoutes.route('/messages', messagesRoute)
chatRoutes.route('/threads', threadsRoute)
chatRoutes.route('/attachments', attachmentsRoute)
chatRoutes.route('/typing', typingRoute)
chatRoutes.route('/receipts', receiptsRoute)
chatRoutes.route('/visitor-info', visitorInfoRoute)

export default chatRoutes
