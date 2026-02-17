// infra/db.ts
import { vpc } from './router-vpc'

// postgresql://[user[:password]@][netloc][:port][/dbname][?param1=value1&...]

export const rds = new sst.aws.Postgres('AuxxAiRdsV2', {
  vpc,
  dev: {
    username: 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    database: 'auxx-ai',
    host: 'localhost',
    port: 5432,
  },
  version: '16.11',
  instance: 't4g.micro',
  database: 'auxxai',
  username: 'postgres',
})

export const redis = new sst.aws.Redis('AuxxAiRedisV2', {
  vpc,
  dev: {
    host: 'localhost',
    port: 6379,
    password: process.env.REDIS_PASSWORD,
  },
  instance: 't4g.micro',
})

// Create interpolated URLs at deploy time
export const DATABASE_URL = $dev
  ? `postgresql://postgres:${process.env.DATABASE_PASSWORD || ''}@localhost:5432/auxx-ai`
  : $interpolate`postgresql://${rds.username}:${rds.password}@${rds.host}:${rds.port}/${rds.database}`

export const REDIS_URL = $dev
  ? process.env.REDIS_PASSWORD
    ? `redis://:${process.env.REDIS_PASSWORD}@localhost:6379`
    : 'redis://localhost:6379'
  : $interpolate`redis://${redis.username}:${redis.password}@${redis.host}:${redis.port}`

// Export Redis config for libraries that need individual values
export const REDIS_HOST = $dev ? 'localhost' : redis.host
export const REDIS_PORT = $dev ? '6379' : $interpolate`${redis.port}`
export const REDIS_PASSWORD = $dev ? process.env.REDIS_PASSWORD || '' : redis.password

// Keep these for backward compatibility (deprecated)
export const getDatabaseUrl = () => DATABASE_URL
export const getRedisUrl = () => REDIS_URL
