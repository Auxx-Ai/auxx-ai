import { Bot, MessageCircle, Minimize2, Send, User, X } from 'lucide-react'

type Message = {
  id: number
  text: string
  sender: 'user' | 'bot'
  timestamp: string
}

const MESSAGES: Message[] = [
  { id: 1, text: 'Hello! How can I help you today?', sender: 'bot', timestamp: '2:30 PM' },
  { id: 2, text: 'Hi, I need help with my order', sender: 'user', timestamp: '2:31 PM' },
  {
    id: 3,
    text: "I can help you with that! What's your order number?",
    sender: 'bot',
    timestamp: '2:31 PM',
  },
  { id: 4, text: 'Order #12345', sender: 'user', timestamp: '2:32 PM' },
]

export const DropdownLiveChat = () => {
  return (
    <div className='relative overflow-hidden rounded-2xl bg-black p-2'>
      <div className='mask-r-from-50% absolute inset-0 items-center [background:radial-gradient(150%_115%_at_50%_5%,transparent_25%,var(--color-emerald-500)_60%,var(--color-background)_100%)]'></div>
      <div className='mask-l-from-35% absolute inset-0 items-center [background:radial-gradient(150%_115%_at_50%_5%,transparent_25%,var(--color-sky-500)_60%,var(--color-background)_100%)]'></div>

      <div className='relative overflow-hidden rounded-xl border border-dashed border-white/25 bg-white/10 pt-8 shadow-lg shadow-black/20'>
        <div className='absolute inset-0 bg-[radial-gradient(var(--color-white)_1px,transparent_1px)] opacity-5 [background-size:12px_12px]'></div>
        <div className='absolute inset-0 translate-y-1/2 rounded-full border border-dotted bg-white/15'></div>

        <div className='flex items-center justify-center'>
          <div className='mask-b-from-55% dark:mask-b-from-75% -mx-4 -mt-4 p-4 pb-0'>
            <div className=' relative w-72 overflow-hidden rounded-2xl border border-black/5 shadow-xl'>
              {/* Chat Header */}
              <div className='bg-blue-600 text-white px-4 py-3 flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <MessageCircle className='size-4' />
                  <span className='text-sm font-medium'>Live Support</span>
                </div>
                <div className='flex items-center gap-1'>
                  <Minimize2 className='size-3 opacity-70 cursor-pointer' />
                  <X className='size-3 opacity-70 cursor-pointer' />
                </div>
              </div>

              {/* Chat Messages */}
              <div className='h-64 overflow-y-auto p-3 space-y-3 bg-gray-50'>
                {MESSAGES.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`flex items-start gap-2 max-w-[80%] ${message.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div
                        className={`size-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
                          message.sender === 'bot'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-600 text-white'
                        }`}>
                        {message.sender === 'bot' ? (
                          <Bot className='size-3' />
                        ) : (
                          <User className='size-3' />
                        )}
                      </div>
                      <div
                        className={`rounded-lg px-3 py-2 text-xs ${
                          message.sender === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-gray-800 border border-gray-200'
                        }`}>
                        {message.text}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Chat Input */}
              <div className='border-t border-gray-200 p-3 bg-white'>
                <div className='flex items-center gap-2'>
                  <input
                    type='text'
                    placeholder='Type your message...'
                    className='flex-1 text-xs px-3 py-2 border border-gray-200 rounded-full focus:outline-none focus:ring-1 focus:ring-blue-500'
                  />
                  <button className='bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 transition-colors'>
                    <Send className='size-3' />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
