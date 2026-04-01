// infra/db.ts
import { shouldDeployDatabaseResources } from './deploy-profile'
import { vpc } from './router-vpc'

// postgresql://[user[:password]@][netloc][:port][/dbname][?param1=value1&...]

export const rds = shouldDeployDatabaseResources()
  ? new sst.aws.Postgres('AuxxAiRdsV2', {
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
  : undefined

export const redis = shouldDeployDatabaseResources()
  ? new sst.aws.Redis('AuxxAiRedisV3', {
      vpc,
      cluster: false,
      dev: {
        host: 'localhost',
        port: 6379,
        password: process.env.REDIS_PASSWORD,
      },
      instance: 't4g.micro',
    })
  : undefined

// Create interpolated URLs at deploy time
// In platform mode, these come from environment variables (e.g. Railway)
export const DATABASE_URL = $dev
  ? `postgresql://postgres:${process.env.DATABASE_PASSWORD || ''}@localhost:5432/auxx-ai`
  : rds
    ? $interpolate`postgresql://${rds.username}:${rds.password}@${rds.host}:${rds.port}/${rds.database}`
    : process.env.DATABASE_URL || ''

export const REDIS_URL = $dev
  ? process.env.REDIS_PASSWORD
    ? `redis://:${process.env.REDIS_PASSWORD}@localhost:6379`
    : 'redis://localhost:6379'
  : redis
    ? $interpolate`redis://${redis.username}:${redis.password}@${redis.host}:${redis.port}`
    : process.env.REDIS_URL || ''

// Export Redis config for libraries that need individual values
export const REDIS_HOST = $dev ? 'localhost' : redis ? redis.host : process.env.REDIS_HOST || ''
export const REDIS_PORT = $dev
  ? '6379'
  : redis
    ? $interpolate`${redis.port}`
    : process.env.REDIS_PORT || '6379'
export const REDIS_PASSWORD = $dev
  ? process.env.REDIS_PASSWORD || ''
  : redis
    ? redis.password
    : process.env.REDIS_PASSWORD || ''

// Keep these for backward compatibility (deprecated)
export const getDatabaseUrl = () => DATABASE_URL
export const getRedisUrl = () => REDIS_URL
