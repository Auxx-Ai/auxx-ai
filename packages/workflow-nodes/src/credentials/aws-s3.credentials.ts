// packages/workflow-nodes/src/credentials/aws-s3.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * AWS S3 credential type for storage operations
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class AwsS3Credentials implements ICredentialType {
  name = 'S3'

  displayName = 'AWS S3'

  documentationUrl = 'aws-s3'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Cloud',
    iconColor: 'text-orange-500',
    backgroundColor: 'from-orange-50 to-yellow-50',
    borderColor: 'border-orange-200',
    category: 'data' as const,
    brandColor: '#FF9900', // AWS orange
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   * Note: Only accessKeyId, secretAccessKey, and region are required
   */
  systemCredentialMapping = {
    accessKeyId: 'S3_ACCESS_KEY_ID',
    secretAccessKey: 'S3_SECRET_ACCESS_KEY',
    region: 'S3_REGION',
    bucket: 'S3_BUCKET',
  }

  /**
   * Optional system credential mapping for advanced configurations
   */
  optionalSystemCredentialMapping = {
    endpoint: 'S3_ENDPOINT',
    sessionToken: 'S3_SESSION_TOKEN',
  }

  /**
   * Form properties for creating/editing S3 credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'Access Key ID',
      name: 'accessKeyId',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'AKIA...',
      description: 'AWS IAM Access Key ID with S3 permissions',
      validation: {
        minLength: 16,
        maxLength: 128,
        pattern: /^AKIA[0-9A-Z]+$/,
        errorMessage: 'Must be a valid AWS Access Key ID starting with AKIA',
      },
    },
    {
      displayName: 'Secret Access Key',
      name: 'secretAccessKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'Enter your AWS Secret Access Key',
      description: 'AWS Secret Access Key corresponding to the Access Key ID',
      validation: {
        minLength: 40,
        maxLength: 40,
        errorMessage: 'AWS Secret Access Key must be exactly 40 characters',
      },
    },
    {
      displayName: 'Region',
      name: 'region',
      type: 'string',
      default: 'us-east-1',
      required: true,
      placeholder: 'us-east-1',
      description: 'AWS region where your S3 buckets are located',
      validation: {
        pattern: /^[a-z0-9-]+$/,
        errorMessage: 'Must be a valid AWS region (e.g., us-east-1, eu-west-1)',
      },
    },
    {
      displayName: 'Custom Endpoint (Optional)',
      name: 'endpoint',
      type: 'string',
      default: '',
      required: false,
      placeholder: 'https://s3.amazonaws.com',
      description: 'Custom S3 endpoint for S3-compatible services (leave empty for AWS S3)',
      validation: {
        url: true,
        errorMessage: 'Must be a valid URL',
      },
    },
    {
      displayName: 'Session Token (Optional)',
      name: 'sessionToken',
      type: 'password',
      default: '',
      required: false,
      placeholder: 'Enter session token if using temporary credentials',
      description: 'AWS session token for temporary security credentials (STS)',
    },
    {
      displayName: 'Default Bucket (Optional)',
      name: 'bucket',
      type: 'string',
      default: '',
      required: false,
      placeholder: 'my-s3-bucket',
      description: 'Default S3 bucket for file operations (can be overridden per operation)',
      validation: {
        pattern: /^[a-z0-9][a-z0-9\-.]{1,61}[a-z0-9]$/,
        errorMessage:
          'Must be a valid S3 bucket name (3-63 characters, lowercase letters, numbers, hyphens, dots)',
      },
    },
  ]

  /**
   * Test credential connection
   * This method is called when users click "Test Connection" in the UI
   */
  // test = {
  //   async test(credentials: Record<string, any>): Promise<{ success: boolean; message: string }> {
  //     try {
  //       // Import AWS SDK dynamically to avoid loading if not needed
  //       const { S3Client, ListBucketsCommand } = await import('@aws-sdk/client-s3')

  //       // Create S3 client with provided credentials
  //       const s3Client = new S3Client({
  //         region: credentials.region,
  //         credentials: {
  //           accessKeyId: credentials.accessKeyId,
  //           secretAccessKey: credentials.secretAccessKey,
  //           ...(credentials.sessionToken && { sessionToken: credentials.sessionToken }),
  //         },
  //         ...(credentials.endpoint && { endpoint: credentials.endpoint }),
  //       })

  //       // Test connection by listing buckets (minimal permission required)
  //       const command = new ListBucketsCommand({})
  //       const response = await s3Client.send(command)

  //       const bucketCount = response.Buckets?.length || 0
  //       return {
  //         success: true,
  //         message: `Successfully connected to AWS S3. Found ${bucketCount} bucket(s).`,
  //       }
  //     } catch (error) {
  //       const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

  //       // Provide helpful error messages for common issues
  //       if (errorMessage.includes('InvalidAccessKeyId')) {
  //         return {
  //           success: false,
  //           message: 'Invalid Access Key ID. Please check your credentials.',
  //         }
  //       }

  //       if (errorMessage.includes('SignatureDoesNotMatch')) {
  //         return {
  //           success: false,
  //           message: 'Invalid Secret Access Key. Please check your credentials.',
  //         }
  //       }

  //       if (errorMessage.includes('TokenRefreshRequired')) {
  //         return {
  //           success: false,
  //           message: 'Session token has expired. Please provide a valid session token.',
  //         }
  //       }

  //       if (errorMessage.includes('NetworkingError') || errorMessage.includes('ENOTFOUND')) {
  //         return {
  //           success: false,
  //           message: 'Unable to connect to S3. Please check your network connection and endpoint.',
  //         }
  //       }

  //       return {
  //         success: false,
  //         message: `Connection test failed: ${errorMessage}`,
  //       }
  //     }
  //   },
  // }

  /**
   * Transform credentials for workflow execution
   * This method can be used to add computed fields or transform the credential format
   */
  authenticate?(credentials: Record<string, any>): Record<string, any> {
    // Add any computed fields or transformations needed for S3 operations
    return {
      ...credentials,
      // Ensure endpoint is properly formatted
      ...(credentials.endpoint && {
        endpoint: credentials.endpoint.replace(/\/$/, ''), // Remove trailing slash
      }),
    }
  }
}
