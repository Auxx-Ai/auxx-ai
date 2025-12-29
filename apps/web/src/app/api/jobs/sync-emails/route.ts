import { NextResponse } from 'next/server'

// console.log('Redis host:', process.env.REDIS_HOST)
// const redisOptions: { connection: { host: string; port: number; password: string } } = {
//   connection: {
//     host: process.env.REDIS_HOST!,
//     port: Number(process.env.REDIS_PORT),
//     password: process.env.REDIS_PASSWORD!,
//   },
// }

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
