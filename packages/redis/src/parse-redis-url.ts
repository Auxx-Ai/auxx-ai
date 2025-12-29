// packages/redis/src/parse-redis-url.ts

/**
 * Parses a Redis URL and extracts its components
 * @param redisUrl - Redis connection string (with or without protocol prefix)
 * @returns Object containing password, url, fullUrl and port
 */
export interface RedisUrlComponents {
  password: string
  url: string
  host: string
  port: number
}

export function parseRedisUrl(redisUrl: string): RedisUrlComponents {
  try {
    // Ensure the URL has a protocol prefix for correct parsing
    let urlString = redisUrl
    if (!urlString.startsWith('rediss://') && !urlString.startsWith('redis://')) {
      urlString = `rediss://${urlString}`
    }

    const parsedUrl = new URL(urlString)

    // Extract the hostname (without protocol, port, or auth)
    const hostname = parsedUrl.hostname

    return {
      password: parsedUrl.password || '',
      host: hostname,
      url: `https://${hostname}`,
      port: Number(parsedUrl.port) || 6379,
    }
  } catch (error) {
    throw new Error(`Failed to parse Redis URL: ${(error as Error).message}`)
  }
}
