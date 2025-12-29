// import { AUXX_API_TOKEN } from '@auxx/sdk/server'

export default async function leadProcessedWebhook(req: Request): Promise<Response> {
  // const body = await req.json()

  // const recordId = body.record_id
  // const status = body.status

  // await fetch({
  // call to Auxx's REST API with AUXX_API_TOKEN
  // })

  return new Response(null, { status: 200 })
}
