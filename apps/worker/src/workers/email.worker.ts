import dotenv from 'dotenv'
dotenv.config()

import { Worker, Job } from 'bullmq'
// import { Job } from 'bullmq'

// const redisOptions = { connection: { host: 'localhost', port: 6379 } }
const redisOptions = {
  connection: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
  },
}

// Processor<DataType, ResultType, NameType>
// Processor
const emailQueue = async (job: Job) => {
  console.log(`Processing job: ${job.id}, sending email to ${job.data.email}`)
  // Simulate email sending delay
  await new Promise((resolve) => setTimeout(resolve, 2000))
  console.log(`Email sent to ${job.data.email}`)
}

// Create a worker that processes jobs from the queue
export const emailWorker = new Worker('emailQueue', emailQueue, redisOptions)

emailWorker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed`)
})

emailWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed: ${err.message}`)
})
