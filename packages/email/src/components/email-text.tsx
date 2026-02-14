// packages/email/src/components/email-text.tsx
import { Heading, Text } from '@react-email/components'
import type React from 'react'

/** Props shared across email typography components */
interface EmailHeadingProps {
  /** Child nodes rendered inside the component */
  children: React.ReactNode
}

/** Props for the email paragraph component */
interface EmailParagraphProps extends EmailHeadingProps {
  /** Optional inline styles merged into the default paragraph styling */
  style?: React.CSSProperties
}

/** Default styling applied to email headings */
const h1 = {
  color: '#333',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
  fontSize: '20px',
  fontWeight: 'bold',
  marginBottom: '15px',
}

/** Email heading component that wraps the React Email Heading primitive */
export function EmailHeading({ children }: EmailHeadingProps): React.JSX.Element {
  return <Heading style={h1}>{children}</Heading>
}

/** Default styling applied to email paragraphs */
const p = {
  color: '#333',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
  fontSize: '14px',
  fontWeight: 'normal',
  marginBottom: '15px',
}

/** Email paragraph component that allows extending the default paragraph style */
export function EmailP({ children, style }: EmailParagraphProps): React.JSX.Element {
  return <Text style={style ? { ...p, ...style } : p}>{children}</Text>
}

export default EmailHeading
