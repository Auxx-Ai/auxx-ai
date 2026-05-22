// apps/api/src/routes/chat/config.ts

import { configService } from '@auxx/credentials'
import { Hono } from 'hono'
import {
  applyChatCorsHeaders,
  loadChatWidgetByChannelId,
  loadHomeFeaturedArticles,
  loadHomeKnowledgeBase,
} from './lib'

const configRoute = new Hono()

configRoute.options('/:channelId', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: false })
  return c.body(null, 204)
})

/**
 * GET /api/chat/config/:channelId
 *
 * Public, cacheable. Returns appearance + realtime config. 404 when the
 * widget is missing or inactive.
 */
configRoute.get('/:channelId', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: false })

  const channelId = c.req.param('channelId')
  const widget = await loadChatWidgetByChannelId(channelId)

  if (!widget || !widget.isActive || !widget.integrationEnabled) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Chat widget not found' } },
      404
    )
  }

  c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=300')

  const [knowledgeBase, featuredArticles] = await Promise.all([
    loadHomeKnowledgeBase(widget.organizationId, widget.home.knowledgeBaseId),
    loadHomeFeaturedArticles(widget.organizationId, widget.home.featuredArticleIds),
  ])

  return c.json({
    channelId: widget.channelId,
    isActive: widget.isActive,
    appearance: widget.appearance,
    home: {
      greetingTemplate: widget.home.greetingTemplate,
      showRecentMessage: widget.home.showRecentMessage,
      showSendMessageCta: widget.home.showSendMessageCta,
      expandedWidthPx: widget.home.expandedWidthPx,
      knowledgeBase,
      featuredArticles,
    },
    branding: {
      footerEnabled: widget.branding.footerEnabled,
    },
    allowDownloadTranscript: widget.allowDownloadTranscript,
    realtime: {
      provider: 'pusher' as const,
      key: configService.get<string>('PUSHER_KEY') ?? '',
      cluster: configService.get<string>('PUSHER_CLUSTER') ?? 'us3',
    },
  })
})

export default configRoute
