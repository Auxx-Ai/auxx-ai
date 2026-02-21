import { NextResponse } from 'next/server'

// Create a queue instance
// const queue = new Queue('emailQueue', redisOptions)

export async function POST(req: Request) {
  try {
    const { email } = await req.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Add job to queue
    // await queue.add('sendEmail', { email })

    return NextResponse.json({ message: `Email job added for ${email}` })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
