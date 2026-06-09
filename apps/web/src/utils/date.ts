import { format, isToday, isYesterday } from 'date-fns'

export const formatRelativeDate = (date: Date | number): string => {
  const dateObj = date instanceof Date ? date : new Date(date)

  if (isToday(dateObj)) {
    return `Today at ${format(dateObj, 'h:mm a')}`
  }

  if (isYesterday(dateObj)) {
    return `Yesterday at ${format(dateObj, 'h:mm a')}`
  }

  // For dates within the last week, you could use:
  // return `${format(dateObj, 'EEEE')} at ${format(dateObj, 'h:mm a')}`;

  // For older dates, use a standard format:
  return format(dateObj, "MMM d, yyyy 'at' h:mm a")
}
