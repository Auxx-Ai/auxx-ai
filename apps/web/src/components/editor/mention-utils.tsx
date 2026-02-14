// src/components/editor/mention-utils.tsx
import type { MentionItem } from './mention-popover'

/**
 * Mock function to fetch users/members for mention suggestions
 * This should be replaced with actual API calls to fetch organization members
 */
export const fetchMentionUsers = async (query: string): Promise<MentionItem[]> => {
  // Mock data - replace with actual API call
  const mockUsers: MentionItem[] = [
    {
      id: '1',
      name: 'John Doe',
      email: 'john.doe@example.com',
      role: 'Admin',
      avatar:
        'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=32&h=32&fit=crop&crop=face',
    },
    {
      id: '2',
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      role: 'Manager',
      avatar:
        'https://images.unsplash.com/photo-1494790108755-2616b612b647?w=32&h=32&fit=crop&crop=face',
    },
    { id: '3', name: 'Bob Johnson', email: 'bob.johnson@example.com', role: 'Developer' },
    { id: '4', name: 'Alice Wilson', email: 'alice.wilson@example.com', role: 'Designer' },
    { id: '5', name: 'Mike Brown', email: 'mike.brown@example.com', role: 'Support' },
  ]

  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Filter users based on query
  if (!query) {
    return mockUsers.slice(0, 5) // Return first 5 users if no query
  }

  return mockUsers.filter(
    (user) =>
      user.name.toLowerCase().includes(query.toLowerCase()) ||
      user.email.toLowerCase().includes(query.toLowerCase()) ||
      user.role?.toLowerCase().includes(query.toLowerCase())
  )
}

/**
 * Real implementation that would fetch from tRPC API
 * Example of how this could be implemented with the project's tRPC setup
 */
export const createMentionFetcher = () => {
  return async (query: string): Promise<MentionItem[]> => {
    try {
      // This would be the actual tRPC call
      // const { data } = await api.user.searchMembers.useQuery({ query })

      // For now, use the mock implementation
      return await fetchMentionUsers(query)
    } catch (error) {
      console.error('Failed to fetch mention users:', error)
      return []
    }
  }
}

/**
 * Helper function to format user display name
 */
export const formatUserDisplayName = (user: MentionItem): string => {
  return user.name
}

/**
 * Helper function to extract mentioned user IDs from editor content
 * This could be used to track who was mentioned in a message
 */
export const extractMentionedUserIds = (content: string): string[] => {
  // This is a simple regex-based approach
  // In a real implementation, you might want to parse the actual editor state
  const mentionRegex = /@(\w+)/g
  const matches = content.match(mentionRegex)

  if (!matches) return []

  // In a real implementation, you'd map display names back to user IDs
  // For now, just return the matched names
  return matches.map((match) => match.substring(1))
}
