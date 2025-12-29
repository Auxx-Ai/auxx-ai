// apps/web/src/app/api/workflows/[workflowId]/webhook/events/route.ts
import { type NextRequest } from 'next/server'
import { auth } from '~/auth/server'
import { headers } from 'next/headers'
import { getRedisClient } from '@auxx/redis'
// import { getRedisClient } from '~/lib/redis'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params

  // Authenticate user
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Set up SSE headers
  const responseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  }

  // Create readable stream
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      controller.enqueue('event: connected\ndata: {"status": "connected"}\n\n')

      // Set up Redis subscription
      const redis = await getRedisClient(true)
      if (!redis) {
        controller.close()
        return
      }

      // Poll for events
      const pollInterval = setInterval(async () => {
        try {
          const event = await redis.rpop(`webhook:test:${workflowId}:events`)
          if (event) {
            controller.enqueue(`data: ${event}\n\n`)
          }
        } catch (error) {
          console.error('Error polling events:', error)
        }
      }, 1000)

      // Heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        controller.enqueue(':heartbeat\n\n')
      }, 30000)

      // Cleanup on close
      req.signal.addEventListener('abort', () => {
        clearInterval(pollInterval)
        clearInterval(heartbeatInterval)
        controller.close()
      })
    },
  })

  return new Response(stream, { headers: responseHeaders })
}
