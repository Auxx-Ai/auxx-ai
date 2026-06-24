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
      knowledgeBase,
      featuredArticles,
    },
    welcomeMessageTemplate: widget.welcomeMessageTemplate,
    agent: widget.agent,
    branding: {
      footerEnabled: widget.branding.footerEnabled,
    },
    allowDownloadTranscript: widget.allowDownloadTranscript,
    suggestedReplies: widget.suggestedReplies,
    privacyPolicyUrl: widget.privacyPolicyUrl,
    chatAudience: widget.chatAudience,
    isOffline: widget.isOffline,
    realtime: {
      provider: 'pusher' as const,
      key: configService.get<string>('PUSHER_KEY') ?? '',
      cluster: configService.get<string>('PUSHER_CLUSTER') ?? 'us3',
      // Self-hosted Sockudo (Pusher-protocol). Absent host → hosted Pusher cloud.
      wsHost: configService.get<string>('PUSHER_HOST') || undefined,
      wsPort: Number(configService.get<number>('PUSHER_PORT')) || 443,
      forceTLS: configService.get<boolean>('PUSHER_USE_TLS') !== false,
    },
  })
})

export default configRoute
