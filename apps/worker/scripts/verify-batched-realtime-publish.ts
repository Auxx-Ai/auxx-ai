// apps/worker/scripts/verify-batched-realtime-publish.ts
//
// End-to-end verification for plans/entity/field-value/batched-realtime-publish-plan.md.
//
// Subscribes to the org's presence channel on the local Sockudo (raw Pusher
// protocol over Node's native WebSocket — no pusher-js dep), then runs a real
// `UnifiedCrudHandler.create` for a 12-value line_item (the exact payload from
// the original repro) and prints every realtime frame received. Expected:
// ONE `fieldValues:updated` frame carrying all input-field entries, plus
// separate hook/inverse frames (line_total, work-order totals). Deletes the
// created record afterwards.
//
// Run: cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm scripts/verify-batched-realtime-publish.ts

import { createHmac } from 'node:crypto'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

const ORG_ID = 'abgwpa1l81reht2zmwrcihfu'
const USER_ID = 'JR28eYz582CHqZN5SFlVrEnXErXmunaj' // m4rkuskk@gmail.com
const CHANNEL = `presence-org-${ORG_ID}`

const key = process.env.PUSHER_KEY!
const secret = process.env.PUSHER_SECRET!
const host = process.env.PUSHER_HOST || 'localhost'
const port = process.env.PUSHER_PORT || '6001'
const scheme = process.env.PUSHER_USE_TLS === 'true' ? 'wss' : 'ws'

interface Frame {
  at: number
  event: string
  summary: string
}
const frames: Frame[] = []
let t0 = 0

function presenceAuth(socketId: string): { auth: string; channel_data: string } {
  const channelData = JSON.stringify({
    user_id: USER_ID,
    user_info: { name: 'verify-script' },
  })
  const signature = createHmac('sha256', secret)
    .update(`${socketId}:${CHANNEL}:${channelData}`)
    .digest('hex')
  return { auth: `${key}:${signature}`, channel_data: channelData }
}

async function subscribe(): Promise<WebSocket> {
  const ws = new WebSocket(
    `${scheme}://${host}:${port}/app/${key}?protocol=7&client=verify&version=1.0`
  )
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('subscribe timeout')), 8000)
    ws.onmessage = (msg) => {
      const frame = JSON.parse(String(msg.data))
      if (frame.event === 'pusher:connection_established') {
        const { socket_id } = JSON.parse(frame.data)
        ws.send(
          JSON.stringify({
            event: 'pusher:subscribe',
            data: { channel: CHANNEL, ...presenceAuth(socket_id) },
          })
        )
      } else if (frame.event === 'pusher_internal:subscription_succeeded') {
        clearTimeout(timeout)
        resolve()
      } else if (frame.event === 'pusher:error') {
        clearTimeout(timeout)
        reject(new Error(`pusher:error ${frame.data ? JSON.stringify(frame.data) : ''}`))
      }
    }
    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('websocket error'))
    }
  })

  ws.onmessage = (msg) => {
    const frame = JSON.parse(String(msg.data))
    if (frame.event?.startsWith('pusher')) return
    const data = typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data
    let summary = ''
    if (frame.event === 'fieldValues:updated') {
      const entries = (data.entries ?? []) as Array<{ key: string; value: unknown }>
      summary = `${entries.length} entries: ${entries
        .map((e) => {
          const fieldId = e.key.split(':').pop()
          const v = e.value
          const shape = Array.isArray(v) ? `[${v.length}]` : v === null ? 'null' : typeof v
          return `${fieldId}=${shape}`
        })
        .join(', ')}`
    } else {
      summary = JSON.stringify(data).slice(0, 120)
    }
    frames.push({ at: Date.now() - t0, event: frame.event, summary })
  }
  return ws
}

async function main() {
  console.log(`connecting to ${scheme}://${host}:${port} channel ${CHANNEL}`)
  const ws = await subscribe()
  console.log('subscribed; creating line_item…')

  const handler = new UnifiedCrudHandler(ORG_ID, USER_ID)
  t0 = Date.now()
  const created = await handler.create('line_item', {
    line_item_qty: 1,
    line_item_unit: null,
    line_item_taxable: true,
    line_item_optional: false,
    line_item_optional_selected: true,
    line_item_sort_order: 3,
    line_item_work_order: 'xrbtfl7syi3sm4mqf5wiayuz:fqk8nf7i64vtwyxdsxtfb47s',
    line_item_name: 'VERIFY batched realtime publish',
    line_item_category: 'service',
    line_item_unit_price: 100000,
    line_item_catalog_item: 'elppl4chr8dhnjfibwryu5to:plqbitfsnl1hpkfq0nqt18wp',
  })
  console.log(`created ${created.recordId} in ${Date.now() - t0}ms; capturing frames for 5s…`)

  await new Promise((r) => setTimeout(r, 5000))
  ws.close()

  console.log(`\n── frames received (${frames.length}) ──`)
  for (const f of frames) {
    console.log(`+${String(f.at).padStart(5)}ms  ${f.event.padEnd(22)} ${f.summary}`)
  }
  const fvFrames = frames.filter((f) => f.event === 'fieldValues:updated')
  console.log(`\nfieldValues:updated frames: ${fvFrames.length}`)

  console.log('\ncleaning up (deleting created record)…')
  await handler.delete(created.recordId)
  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
