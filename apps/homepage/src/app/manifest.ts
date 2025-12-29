import type { MetadataRoute } from 'next'
import { config } from '~/lib/config'
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: config.name,
    short_name: config.shortName,
    description: config.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#fff',
    theme_color: '#fff',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}
