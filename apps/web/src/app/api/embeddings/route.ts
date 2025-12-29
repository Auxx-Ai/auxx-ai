// app/api/embeddings/route.ts
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
// import { createEmbedding } from '@auxx/lib/embeddings'
import { auth } from '~/auth/server'

// Generate and return an embedding
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })

  // const session = await auth()
  if (!session) {
    return NextResponse.json({ status: 401 })
  }

  try {
    const { text } = await request.json()

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 })
    }

    // const embedding = await createEmbedding(text)

    // return NextResponse.json({ embedding })
  } catch (error: any) {
    console.error('Error generating embedding:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate embedding' },
      { status: 500 }
    )
  }
}
