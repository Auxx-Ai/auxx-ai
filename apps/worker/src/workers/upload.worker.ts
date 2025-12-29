import { Worker } from 'bullmq'
import { Server } from 'socket.io'
import dotenv from 'dotenv'

dotenv.config()

const redisOptions = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || '',
  },
}

// WebSocket server instance
let io: Server | null = null
export const setSocketIO = (socket: Server) => {
  io = socket
}

// BullMQ Worker
export const uploadWorker = new Worker(
  'uploadQueue',
  async (job) => {
    const { filePath } = job.data
    console.log(`🎥 Processing video: ${filePath}`)

    // Simulate video processing steps
    for (let progress = 0; progress <= 100; progress += 20) {
      await new Promise((resolve) => setTimeout(resolve, 1000)) // Simulate processing time
      io?.emit(`progress:${job.id}`, { progress })
    }

    // Simulate file processing completion
    await new Promise((resolve) => setTimeout(resolve, 2000))
    io?.emit(`progress:${job.id}`, { progress: 100, completed: true })

    console.log(`✅ Video processing complete: ${filePath}`)
  },
  redisOptions
)

// Listen for job completion
uploadWorker.on('completed', async (job) => {
  console.log(`🎉 Job ${job.id} completed`)
})

// Handle errors
uploadWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed: ${err.message}`)
})
