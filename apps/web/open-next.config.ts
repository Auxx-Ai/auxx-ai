import type { OpenNextConfig } from '@opennextjs/aws/types/open-next'

const config = {
  default: {
    override: {
      wrapper: 'aws-lambda-streaming',
    },
  },
} satisfies OpenNextConfig

export default config
