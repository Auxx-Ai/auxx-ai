/**
 * AuxxChat Widget (Vanilla JS Version - CSS Variable Enhanced with Session Persistence & Closure Handling)
 * A customizable chat widget for customer support
 *
 * Version: 1.3.0-vanilla-cssvars-persist-close
 *
 * This file should be placed in your public directory:
 * /public/js/bundle.js
 */
;((window) => {
  // Check for dependencies
  if (typeof fetch === 'undefined') {
    console.error('AuxxChat Error: Fetch API not supported in this browser.')
    return
  }
  if (typeof localStorage === 'undefined') {
    console.error(
      'AuxxChat Error: LocalStorage not supported or disabled in this browser. Session persistence unavailable.'
    )
    // Decide if widget should fail completely or run without persistence
    // return; // Option: Stop if localStorage is required
  }

  // Helper function to safely interact with localStorage
  const safeLocalStorage = {
    getItem: (key) => {
      try {
        return localStorage.getItem(key)
      } catch (e) {
        console.warn('[AuxxChat safeLocalStorage] Error getting item:', key, e)
        return null
      }
    },
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, value)
      } catch (e) {
        console.warn('[AuxxChat safeLocalStorage] Error setting item:', key, e)
      }
    },
    removeItem: (key) => {
      try {
        localStorage.removeItem(key)
      } catch (e) {
        console.warn('[AuxxChat safeLocalStorage] Error removing item:', key, e)
      }
    },
  }

  const AuxxChat = {
    init: (config) => {
      console.log('[AuxxChat init] Received config:', config)

      // --- Configuration with Defaults ---
      let userTypingTimer = null
      let lastTypingState = false

      const baseTrpcUrl = config.trpcBaseUrl || window.location.origin + '/api/trpc'
      const initEndpoint = config.initEndpoint || `${baseTrpcUrl}/chat.initialize`
      const sendMessageEndpoint = config.sendMessageEndpoint || `${baseTrpcUrl}/chat.sendMessage`
      const pusherKey = config.pusherKey || window.NEXT_PUBLIC_PUSHER_KEY
      const pusherCluster = config.pusherCluster || 'us3'
      const widgetId = config.widgetId || config.integrationId || 'preview'

      // --- LocalStorage Keys (Scoped by widgetId) ---
      const LS_KEY_SESSION_ID = `auxx_chat_${widgetId}_session_id`
      const LS_KEY_THREAD_ID = `auxx_chat_${widgetId}_thread_id`
      const LS_KEY_VISITOR_ID = `auxx_chat_${widgetId}_visitor_id`
      const LS_KEY_VISITOR_ID_FALLBACK = 'auxx_visitor_id'

      // Core Visual Config
      const primaryColor = config.primaryColor || '#4F46E5'
      const position = (config.position || 'bottom-right').toLowerCase().replace('_', '-')
      const autoOpen = config.autoOpen || false
      const welcomeMessage = config.welcomeMessage || null
      const logoUrl = config.logoUrl || null
      const title = config.title || 'Chat'
      const subtitle = config.subtitle || null
      const mobileFullScreen = config.mobileFullScreen !== false
      const fontFamily =
        config.fontFamily ||
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
      const customCssVariables = config.cssVariables || {}

      // --- State Variables ---
      let isOpen = autoOpen
      let messages = []
      let inputText = ''
      let isConnecting = false
      let connectionError = null
      let isSending = false
      let isAgentTyping = false
      let isSessionClosed = false // <-- New State Variable
      let pusher = null
      let channel = null

      // --- Session State ---
      let sessionId = null
      let threadId = null
      let visitorId = null

      // --- DOM Element References ---
      let chatButton = null
      let chatWindow = null
      let messageListElement = null
      let inputElement = null
      let sendButtonElement = null
      let typingIndicatorElement = null
      let errorInfoElement = null
      let connectingInfoElement = null
      let rootElement = null
      let styleElement = null

      // --- Read initial state from LocalStorage ---
      const initialSessionId = safeLocalStorage.getItem(LS_KEY_SESSION_ID)
      const initialThreadId = safeLocalStorage.getItem(LS_KEY_THREAD_ID)
      const initialVisitorId =
        safeLocalStorage.getItem(LS_KEY_VISITOR_ID) ||
        safeLocalStorage.getItem(LS_KEY_VISITOR_ID_FALLBACK)

      if (initialSessionId && initialThreadId) {
        console.log('[AuxxChat init] Found existing session info in localStorage:', {
          sessionId: initialSessionId,
          threadId: initialThreadId,
          visitorId: initialVisitorId,
        })
        visitorId = initialVisitorId
      } else {
        console.log('[AuxxChat init] No existing session info found in localStorage.')
        visitorId = initialVisitorId
      }

      // --- Find or create root element ---
      let container = document.getElementById('auxx-chat-widget-container')
      if (!container) {
        console.warn(
          '[AuxxChat init] Container #auxx-chat-widget-container not found. Creating one.'
        )
        container = document.createElement('div')
        container.id = 'auxx-chat-widget-container'
        document.body.appendChild(container)
      }
      const rootElementId = `auxx-chat-widget-root-${widgetId}`
      rootElement = document.getElementById(rootElementId)
      if (!rootElement) {
        rootElement = document.createElement('div')
        rootElement.id = rootElementId
        container.appendChild(rootElement)
      } else {
        console.warn('[AuxxChat init] Root element already exists:', rootElementId)
        rootElement.innerHTML = ''
      }

      // --- Helper Functions ---

      function getPositionStyles(pos) {
        const offset = 'var(--auxx-chat-position-offset, 20px)'
        const styles = {
          'bottom-right': { bottom: offset, right: offset },
          'bottom-left': { bottom: offset, left: offset },
          'top-right': { top: offset, right: offset },
          'top-left': { top: offset, left: offset },
        }
        return styles[pos] || styles['bottom-right']
      }

      function applyStyles(element, styles) {
        for (const property in styles) {
          element.style[property] = styles[property]
        }
      }

      function hexToRgb(hex) {
        let r = 0,
          g = 0,
          b = 0
        hex = hex.replace(/^#/, '')
        if (hex.length === 3) {
          r = parseInt(hex[0] + hex[0], 16)
          g = parseInt(hex[1] + hex[1], 16)
          b = parseInt(hex[2] + hex[2], 16)
        } else if (hex.length === 6) {
          r = parseInt(hex[0] + hex[1], 16)
          g = parseInt(hex[2] + hex[3], 16)
          b = parseInt(hex[4] + hex[5], 16)
        } else {
          console.warn('[AuxxChat hexToRgb] Invalid hex format:', '#' + hex)
          return null
        }
        return `${r}, ${g}, ${b}`
      }

      function applyConfigVariables() {
        if (!rootElement) return
        rootElement.style.setProperty('--auxx-chat-primary-color', primaryColor)
        if (primaryColor.startsWith('#')) {
          try {
            const rgb = hexToRgb(primaryColor)
            rootElement.style.setProperty('--auxx-chat-primary-color-rgb', rgb || '79, 70, 229')
          } catch (e) {
            console.warn('[AuxxChat] Could not parse primaryColor hex to RGB:', primaryColor, e)
            rootElement.style.setProperty('--auxx-chat-primary-color-rgb', '79, 70, 229')
          }
        } else {
          rootElement.style.setProperty(
            '--auxx-chat-primary-color-rgb',
            primaryColor.replace(/[^0-9,]/g, '') || '79, 70, 229'
          )
        }
        rootElement.style.setProperty('--auxx-chat-font-family', fontFamily)
        for (const [key, value] of Object.entries(customCssVariables)) {
          if (key.startsWith('--') && typeof value === 'string') {
            rootElement.style.setProperty(key, value)
          } else {
            console.warn(`[AuxxChat] Invalid custom CSS variable format: ${key}: ${value}`)
          }
        }
      }

      function handleFetchError(operation, error, response = null) {
        console.error(`[AuxxChat] Error during ${operation}:`, error)
        let errorMessage = `Failed to ${operation}.`
        if (response?.status) {
          errorMessage += ` Status: ${response.status}`
        } else if (error instanceof TypeError && error.message.includes('fetch')) {
          errorMessage += ' Network error or CORS issue.'
        } else if (error.message) {
          errorMessage += ` ${error.message}`
        }

        if (operation === 'chat initialization') {
          connectionError = errorMessage
          clearSessionData()
        }
        isConnecting = false
        isSending = false
        updateUIState()

        if (operation !== 'chat initialization' && errorInfoElement) {
          const temporaryError = `Failed to ${operation}. Please try again.`
          errorInfoElement.textContent = temporaryError
          errorInfoElement.style.display = 'block'
          setTimeout(() => {
            if (errorInfoElement && errorInfoElement.textContent === temporaryError) {
              errorInfoElement.textContent = ''
              errorInfoElement.style.display = 'none'
            }
          }, 5000)
        }
      }

      function scrollToBottom(behavior = 'smooth') {
        if (messageListElement) {
          setTimeout(() => {
            if (messageListElement) {
              messageListElement.scrollTo({
                top: messageListElement.scrollHeight,
                behavior: behavior,
              })
            }
          }, 50)
        }
      }

      function formatTimestamp(date) {
        if (!(date instanceof Date) || Number.isNaN(date)) return ''
        return date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      }

      function createMessageElement(message) {
        const messageDiv = document.createElement('div')
        const senderType = message.sender?.toLowerCase() || 'system'
        messageDiv.className = `auxx-chat-message auxx-chat-message-${senderType}`
        if (message.id) {
          messageDiv.dataset.id = message.id
        }

        const contentDiv = document.createElement('div')
        contentDiv.className = 'auxx-chat-message-content'
        contentDiv.textContent = message.content
        messageDiv.appendChild(contentDiv)

        if (senderType === 'user' && message.status) {
          const statusDiv = document.createElement('span')
          statusDiv.className = 'auxx-chat-message-status'
          statusDiv.textContent =
            message.status === 'sending'
              ? ' (Sending...)'
              : message.status === 'error'
                ? ' (Failed)'
                : ''
          contentDiv.appendChild(statusDiv)
        }
        return messageDiv
      }

      function addMessageToDOM(message) {
        if (!messageListElement || !message || !message.id) return

        const existingMsgDiv = messageListElement.querySelector(`[data-id="${message.id}"]`)
        if (existingMsgDiv) {
          const statusSpan = existingMsgDiv.querySelector('.auxx-chat-message-status')
          if (statusSpan) {
            if (message.status === 'sent') statusSpan.textContent = ''
            else if (message.status === 'error') statusSpan.textContent = ' (Failed)'
            else if (message.status === 'sending') statusSpan.textContent = ' (Sending...)'
          }
          return
        }
        const messageElement = createMessageElement(message)
        messageListElement.appendChild(messageElement)
        scrollToBottom()
      }

      function renderMessages() {
        if (!messageListElement) return
        const preservedElements = []
        if (connectingInfoElement) preservedElements.push(connectingInfoElement)
        if (errorInfoElement) preservedElements.push(errorInfoElement)

        messageListElement.innerHTML = ''
        preservedElements.forEach((el) => messageListElement.appendChild(el))

        messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)) // Use timestamp

        messages.forEach((message) => {
          const messageElement = createMessageElement(message)
          messageListElement.appendChild(messageElement)
        })

        updateTypingIndicator()
      }

      function updateTypingIndicator() {
        if (!messageListElement) return

        if (typingIndicatorElement && typingIndicatorElement.parentNode === messageListElement) {
          messageListElement.removeChild(typingIndicatorElement)
          typingIndicatorElement = null
        }

        if (isAgentTyping) {
          typingIndicatorElement = document.createElement('div')
          typingIndicatorElement.className =
            'auxx-chat-message auxx-chat-message-agent auxx-chat-message-typing'
          const contentDiv = document.createElement('div')
          contentDiv.className = 'auxx-chat-message-content'
          contentDiv.innerHTML = '<span>.</span><span>.</span><span>.</span>'
          typingIndicatorElement.appendChild(contentDiv)
          messageListElement.appendChild(typingIndicatorElement)
          scrollToBottom()
        }
      }

      function updateUIState() {
        if (chatWindow) {
          chatWindow.style.display = isOpen ? 'flex' : 'none'
          const isMobile = window.innerWidth < 640
          chatWindow.classList.toggle(
            'auxx-chat-fullscreen',
            isOpen && isMobile && mobileFullScreen
          )
        }
        if (chatButton) {
          chatButton.style.display = isOpen ? 'none' : 'flex'
        }
        if (connectingInfoElement) {
          connectingInfoElement.style.display = isConnecting ? 'block' : 'none'
        }
        if (errorInfoElement) {
          errorInfoElement.textContent = connectionError ? `Error: ${connectionError}` : ''
          errorInfoElement.style.display = connectionError ? 'block' : 'none'
        }

        // --- Modified Disable Logic ---
        const disableInput = isConnecting || !!connectionError || isSessionClosed

        if (inputElement) {
          inputElement.disabled = disableInput
          inputElement.value = inputText // Keep synced
          // --- Modified Placeholder Logic ---
          if (isSessionClosed) {
            inputElement.placeholder = 'Chat closed by agent'
          } else if (connectionError) {
            inputElement.placeholder = 'Chat unavailable'
          } else if (isConnecting) {
            inputElement.placeholder = 'Connecting...'
          } else {
            inputElement.placeholder = 'Type your message...'
          }
        }
        if (sendButtonElement) {
          sendButtonElement.disabled = disableInput || !inputText.trim() || isSending
          sendButtonElement.textContent = isSending ? '...' : 'Send'
        }

        updateTypingIndicator()
      }

      function toggleChat() {
        isOpen = !isOpen
        updateUIState()
        // Only initialize if opening, not closed, not connecting, no error, and no session ID yet
        if (isOpen && !sessionId && !isConnecting && !connectionError && !isSessionClosed) {
          console.log('[AuxxChat toggleChat] Opening chat, initiating session...')
          initializeSession()
        }
        if (isOpen && messages.length > 0) {
          setTimeout(() => scrollToBottom('auto'), 50)
        }
        // Focus input only if chat is usable
        if (isOpen && inputElement && !isConnecting && !connectionError && !isSessionClosed) {
          setTimeout(() => inputElement.focus(), 100)
        }
      }

      function handleInputChange(event) {
        inputText = event.target.value
        if (sendButtonElement) {
          // Disable based on new condition
          const disableInput = isConnecting || !!connectionError || isSessionClosed
          sendButtonElement.disabled = disableInput || !inputText.trim() || isSending
        }

        if (sessionId && !isSessionClosed) {
          // Clear existing timer
          if (userTypingTimer) clearTimeout(userTypingTimer)

          // If there's text and we weren't already typing, send typing=true
          if (inputText.trim() && !lastTypingState) {
            lastTypingState = true
            sendTypingState(true)
          }

          // Set timer to send typing=false after 1.5 seconds of inactivity
          userTypingTimer = setTimeout(() => {
            if (lastTypingState) {
              lastTypingState = false
              sendTypingState(false)
            }
          }, 1500)
        }
      }

      // Add new function to send typing state via fetch
      function sendTypingState(isTyping) {
        if (!sessionId || !threadId) return

        // Simple fetch to notify server about typing state
        fetch(`${window.location.origin}/api/trpc/chat.setTyping`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ json: { sessionId, threadId, isTyping } }),
        }).catch((err) => console.warn('[AuxxChat] Failed to send typing state:', err))
      }

      function handleSendMessage() {
        // --- Added Session Closed Check ---
        if (isSessionClosed) {
          console.log('[AuxxChat] Attempted to send message, but session is closed.')
          return // Prevent sending
        }

        const content = inputText.trim()
        if (!content || !sessionId || !threadId || isSending || isConnecting || connectionError)
          return

        isSending = true
        const clientMessageId = 'client-' + Date.now()
        const userMessage = {
          id: clientMessageId,
          content: content,
          sender: 'user', // Keep consistent case
          timestamp: new Date(),
          status: 'sending',
        }

        messages.push(userMessage)
        inputText = ''
        addMessageToDOM(userMessage)
        updateUIState()
        if (inputElement) {
          inputElement.focus()
        }

        fetch(sendMessageEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            json: { sessionId, threadId, content, clientMessageId, visitorId },
          }),
        })
          .then(async (response) => {
            if (!response.ok) {
              const text = await response.text()
              console.error('[AuxxChat] Send message non-OK response:', text)
              let errorDetail = `HTTP error! Status: ${response.status}`
              try {
                const jsonError = JSON.parse(text)
                errorDetail += ` - ${jsonError.message || text}`
              } catch (e) {
                errorDetail += ` - ${text || response.statusText}`
              }
              throw new Error(errorDetail)
            }
            return response.json()
          })
          .then((data) => {
            console.log('[AuxxChat] Send message success response:', data)
            const responseData = data?.result?.data?.json || data?.result?.data || data
            const serverMessageId = responseData?.messageId
            const messageIndex = messages.findIndex((m) => m.id === clientMessageId)

            if (messageIndex > -1) {
              if (messages[messageIndex].status === 'sending') {
                messages[messageIndex].status = 'sent'
                const finalMessageId = serverMessageId || clientMessageId
                if (serverMessageId && messages[messageIndex].id === clientMessageId) {
                  messages[messageIndex].id = serverMessageId
                  const msgElement = messageListElement?.querySelector(
                    `[data-id="${clientMessageId}"]`
                  )
                  if (msgElement) msgElement.dataset.id = serverMessageId
                }
                const msgElement = messageListElement?.querySelector(
                  `[data-id="${finalMessageId}"]`
                )
                const statusSpan = msgElement?.querySelector('.auxx-chat-message-status')
                if (statusSpan) statusSpan.textContent = ''
              }
            }
            isSending = false
            updateUIState()
          })
          .catch((error) => {
            console.error('[AuxxChat] Error sending message:', error)
            const messageIndex = messages.findIndex((m) => m.id === clientMessageId)
            if (messageIndex > -1) {
              messages[messageIndex].status = 'error'
              const msgElement = messageListElement?.querySelector(`[data-id="${clientMessageId}"]`)
              const statusSpan = msgElement?.querySelector('.auxx-chat-message-status')
              if (statusSpan) statusSpan.textContent = ' (Failed)'
            }
            isSending = false
            handleFetchError('sending message', error)
            updateUIState()
          })
      }

      function setupPusherConnection() {
        if (!sessionId || !threadId) {
          console.warn('[AuxxChat setupPusher] Missing sessionId or threadId.')
          return
        }
        if (pusher) {
          console.warn('[AuxxChat setupPusher] Pusher already initialized. Disconnecting first.')
          pusher.disconnect()
          pusher = null
          channel = null
        }
        if (typeof window.Pusher === 'undefined') {
          console.error('[AuxxChat setupPusher] Pusher library not loaded.')
          if (errorInfoElement) {
            errorInfoElement.textContent = 'Real-time updates unavailable (library missing).'
            errorInfoElement.style.display = 'block'
          }
          return
        }
        try {
          if (!pusherKey) throw new Error('Pusher key is missing in config.')

          console.log('[AuxxChat setupPusher] Initializing Pusher...')
          pusher = new window.Pusher(pusherKey, {
            cluster: pusherCluster,
            authEndpoint: '/api/pusher/auth',
            forceTLS: true,
            auth: { params: { sessionId: sessionId, visitorId: visitorId } },
          })

          const channelName = `private-chat-${sessionId}`
          console.log('[AuxxChat setupPusher] Subscribing to channel:', channelName)
          channel = pusher.subscribe(channelName)

          // --- Pusher Bindings ---
          pusher.connection.bind('connected', () => {
            console.log('[AuxxChat Pusher] Connected.')
            if (errorInfoElement?.textContent?.includes('Real-time')) {
              errorInfoElement.textContent = ''
              errorInfoElement.style.display = 'none'
            }
          })

          pusher.connection.bind('error', (err) => {
            console.error('[AuxxChat Pusher] Connection error:', err)
            if (errorInfoElement) {
              let errorMsg = 'Real-time connection issue'
              if (err.error?.data?.message) errorMsg += `: ${err.error.data.message}`
              errorInfoElement.textContent = errorMsg
              errorInfoElement.style.display = 'block'
            }
          })
          channel.bind('pusher:subscription_succeeded', () => {
            console.log('[AuxxChat Pusher] Subscribed to', channelName)
          })
          channel.bind('pusher:subscription_error', (error) => {
            console.error('[AuxxChat Pusher] Subscription error:', error)
            if (errorInfoElement) {
              errorInfoElement.textContent = `Real-time auth failed (Status: ${error.status}).`
              errorInfoElement.style.display = 'block'
            }
            if (pusher && (error.status === 403 || error.status === 401)) {
              pusher.disconnect()
            }
          })
          channel.bind('new-message', (data) => {
            console.log('[AuxxChat Pusher] Received event: new-message', data)
            if (!data || !data.id || !data.content) return
            const newMessage = {
              ...data,
              timestamp: new Date(data.timestamp || Date.now()), // Use timestamp field
              sender: data.sender?.toLowerCase() || 'agent', // Keep consistent case
              status: 'sent',
            }
            if (!messages.some((m) => m.id === newMessage.id)) {
              messages.push(newMessage)
              addMessageToDOM(newMessage)
            } else {
              addMessageToDOM(newMessage) // Update existing if needed
            }
          })
          channel.bind('typing', (data) => {
            if (data && data.sender?.toLowerCase() === 'agent') {
              console.log('typing:', data)
              isAgentTyping = !!data.isTyping
              updateTypingIndicator()
            }
          })
          channel.bind('message-sent', (data) => {
            console.log('[AuxxChat Pusher] Received event: message-sent confirmation', data)
            if (data?.clientMessageId) {
              const messageIndex = messages.findIndex((msg) => msg.id === data.clientMessageId)
              if (messageIndex > -1 && messages[messageIndex].status !== 'sent') {
                const serverMessageId = data.messageId || messages[messageIndex].id
                messages[messageIndex].id = serverMessageId
                messages[messageIndex].status = 'sent'
                const msgElement = messageListElement?.querySelector(
                  `[data-id="${data.clientMessageId}"]`
                )
                if (msgElement) {
                  msgElement.dataset.id = serverMessageId
                  const statusSpan = msgElement.querySelector('.auxx-chat-message-status')
                  if (statusSpan) statusSpan.textContent = ''
                }
              }
            }
          })

          // --- New Binding for Session Closure ---
          channel.bind('session-closed', (data) => {
            console.log('[AuxxChat Pusher] Received session-closed event:', data)
            isSessionClosed = true // Set the state flag

            // Create and add system message
            const closedByName = data?.closedBy?.name
            const closedMessageContent = `This chat session has been closed${closedByName ? ' by ' + closedByName : ''}.`
            const systemMessage = {
              id: 'system-closed-' + Date.now(),
              content: closedMessageContent,
              sender: 'system', // Use consistent case
              timestamp: new Date(data.createdAt || Date.now()),
              status: 'delivered', // Or omit status
            }
            messages.push(systemMessage)
            addMessageToDOM(systemMessage)

            // Clear typing indicator if agent was typing
            isAgentTyping = false

            // Update UI immediately to disable input etc.
            updateUIState()

            // Optionally disconnect Pusher for this closed session
            if (pusher) {
              console.log('[AuxxChat] Disconnecting Pusher as session is closed.')
              pusher.disconnect()
              // No need to nullify pusher/channel here if destroy handles it
            }
          })
          // --- End New Binding ---
        } catch (error) {
          console.error('[AuxxChat setupPusher] Error:', error)
          if (errorInfoElement) {
            errorInfoElement.textContent = 'Failed to setup real-time connection: ' + error.message
            errorInfoElement.style.display = 'block'
          }
          if (pusher) {
            pusher.disconnect()
            pusher = null
          }
        }
      }

      function initializeSession() {
        const resumeSessionId = initialSessionId
        const resumeThreadId = initialThreadId
        const currentVisitorId = visitorId

        if (isConnecting) {
          console.warn('[AuxxChat initializeSession] Initialization already in progress.')
          return
        }
        if (sessionId && threadId && !connectionError) {
          console.log('[AuxxChat initializeSession] Session already active:', sessionId)
          if (!pusher || pusher.connection.state !== 'connected') {
            console.log(
              '[AuxxChat initializeSession] Session active, ensuring Pusher is connected.'
            )
            setupPusherConnection()
          }
          return
        }

        isConnecting = true
        connectionError = null
        isSessionClosed = false // Reset session closed status on new init attempt
        messages = []
        renderMessages()
        updateUIState()

        console.log(`[AuxxChat initializeSession] Initializing session via: ${initEndpoint}`)
        const payload = {
          integrationId: widgetId,
          url: window.location.href,
          referrer: document.referrer || '',
          userAgent: navigator.userAgent,
          visitorId: currentVisitorId || undefined,
          sessionId: resumeSessionId || undefined,
          threadId: resumeThreadId || undefined,
        }
        console.log('[AuxxChat initializeSession] Sending payload:', payload)

        fetch(initEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ json: payload }),
        })
          .then(async (response) => {
            if (!response.ok) {
              const text = await response.text()
              console.error('[AuxxChat Init] Server non-OK response:', text)
              let errorDetail = `HTTP error! Status: ${response.status}`
              try {
                const jsonError = JSON.parse(text)
                errorDetail += ` - ${jsonError.message || text}`
              } catch (e) {
                errorDetail += ` - ${text || response.statusText}`
              }
              if (response.status === 404 || response.status === 400) {
                console.warn(
                  '[AuxxChat Init] Backend indicated invalid session/thread ID. Clearing stored IDs.'
                )
                clearSessionData()
              }
              throw new Error(errorDetail)
            }
            const contentType = response.headers.get('content-type')
            if (!contentType?.includes('application/json')) {
              const text = await response.text()
              console.error('[AuxxChat Init] Non-JSON response received:', text)
              throw new Error(`Received non-JSON response from server.`)
            }
            return response.json()
          })
          .then((data) => {
            console.log('[AuxxChat Init] Raw success response data:', data)
            const responseData = data?.result?.data?.json || data?.result?.data || data

            if (
              !responseData ||
              !responseData.sessionId ||
              !responseData.threadId ||
              !responseData.visitorId
            ) {
              console.error('[AuxxChat Init] Invalid response structure:', responseData)
              throw new Error('Initialization failed: Invalid data received.')
            }

            const isNewSession = !resumeSessionId || responseData.sessionId !== resumeSessionId
            console.log('[AuxxChat Init] Session initialized.', 'Is new session:', isNewSession)

            sessionId = responseData.sessionId
            threadId = responseData.threadId
            visitorId = responseData.visitorId
            isConnecting = false
            connectionError = null
            isSessionClosed = false // Ensure session starts as not closed

            safeLocalStorage.setItem(LS_KEY_SESSION_ID, sessionId)
            safeLocalStorage.setItem(LS_KEY_THREAD_ID, threadId)
            safeLocalStorage.setItem(LS_KEY_VISITOR_ID, visitorId)
            if (safeLocalStorage.getItem(LS_KEY_VISITOR_ID_FALLBACK)) {
              safeLocalStorage.removeItem(LS_KEY_VISITOR_ID_FALLBACK)
            }

            messages = []
            if (isNewSession && welcomeMessage) {
              // messages.push({
              //   id: 'welcome-' + Date.now(),
              //   content: welcomeMessage,
              //   sender: 'system',
              //   timestamp: new Date(Date.now() - 1000),
              //   status: 'delivered',
              // })
            }
            if (responseData.messages && Array.isArray(responseData.messages)) {
              console.log(
                `[AuxxChat Init] Received ${responseData.messages.length} historical messages.`
              )
              const historicalMessages = responseData.messages.map((msg) => ({
                ...msg,
                timestamp: new Date(msg.timestamp || Date.now()), // Use timestamp field
                sender: msg.sender?.toLowerCase() || 'unknown', // Keep consistent case
                status: 'sent',
              }))
              messages = [...historicalMessages]
            }

            renderMessages()
            updateUIState()
            scrollToBottom('auto')
            setupPusherConnection()
          })
          .catch((error) => {
            console.error('[AuxxChat Init] Initialization fetch/processing error:', error)
            handleFetchError(
              'chat initialization',
              new Error(error.message || 'Unknown initialization error')
            )
          })
      }

      function clearSessionData() {
        console.log('[AuxxChat] Clearing session data from localStorage.')
        safeLocalStorage.removeItem(LS_KEY_SESSION_ID)
        safeLocalStorage.removeItem(LS_KEY_THREAD_ID)
        safeLocalStorage.removeItem(LS_KEY_VISITOR_ID)
        safeLocalStorage.removeItem(LS_KEY_VISITOR_ID_FALLBACK)
        sessionId = null
        threadId = null
        // Keep visitorId? Maybe.
      }

      function createDOM() {
        rootElement.innerHTML = ''
        const positionStyle = getPositionStyles(position)

        chatButton = document.createElement('button')
        chatButton.className = 'auxx-chat-button'
        chatButton.setAttribute('aria-label', 'Open Chat')
        applyStyles(chatButton, {
          position: 'fixed',
          zIndex: 9998,
          ...positionStyle,
        })
        chatButton.addEventListener('click', toggleChat)
        rootElement.appendChild(chatButton)

        chatWindow = document.createElement('div')
        chatWindow.className = 'auxx-chat-window'
        applyStyles(chatWindow, {
          position: 'fixed',
          zIndex: 9999,
          display: 'none',
          ...positionStyle,
        })
        rootElement.appendChild(chatWindow)
        applyConfigVariables()

        const header = document.createElement('div')
        header.className = 'auxx-chat-header'
        chatWindow.appendChild(header)
        const headerContent = document.createElement('div')
        headerContent.className = 'auxx-chat-header-content'
        header.appendChild(headerContent)
        if (logoUrl) {
          const logo = document.createElement('img')
          logo.src = logoUrl
          logo.alt = title + ' Logo'
          logo.className = 'auxx-chat-logo'
          logo.onerror = () => {
            console.warn('[AuxxChat] Failed to load logo:', logoUrl)
            logo.style.display = 'none'
          }
          headerContent.appendChild(logo)
        }
        const titlesDiv = document.createElement('div')
        titlesDiv.className = 'auxx-chat-titles'
        headerContent.appendChild(titlesDiv)
        const titleElement = document.createElement('h3')
        titleElement.className = 'auxx-chat-title'
        titleElement.textContent = title
        titlesDiv.appendChild(titleElement)
        if (subtitle) {
          const subtitleElement = document.createElement('p')
          subtitleElement.className = 'auxx-chat-subtitle'
          subtitleElement.textContent = subtitle
          titlesDiv.appendChild(subtitleElement)
        }
        const closeButton = document.createElement('button')
        closeButton.className = 'auxx-chat-close'
        closeButton.setAttribute('aria-label', 'Close Chat')
        closeButton.addEventListener('click', toggleChat)
        header.appendChild(closeButton)

        messageListElement = document.createElement('div')
        messageListElement.className = 'auxx-chat-messages'
        chatWindow.appendChild(messageListElement)

        connectingInfoElement = document.createElement('div')
        connectingInfoElement.className = 'auxx-chat-info auxx-chat-connecting-info'
        connectingInfoElement.textContent = 'Connecting...'
        connectingInfoElement.style.display = 'none'
        messageListElement.appendChild(connectingInfoElement)

        errorInfoElement = document.createElement('div')
        errorInfoElement.className = 'auxx-chat-info auxx-chat-error-info'
        errorInfoElement.style.display = 'none'
        messageListElement.appendChild(errorInfoElement)

        const inputArea = document.createElement('div')
        inputArea.className = 'auxx-chat-input-area'
        chatWindow.appendChild(inputArea)
        inputElement = document.createElement('input')
        inputElement.type = 'text'
        inputElement.className = 'auxx-chat-input'
        inputElement.placeholder = 'Type your message...'
        inputElement.setAttribute('aria-label', 'Message Input')
        inputElement.addEventListener('input', handleInputChange)
        inputElement.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSendMessage()
          }
        })
        inputArea.appendChild(inputElement)
        sendButtonElement = document.createElement('button')
        sendButtonElement.className = 'auxx-chat-send'
        sendButtonElement.textContent = 'Send'
        sendButtonElement.setAttribute('aria-label', 'Send Message')
        sendButtonElement.addEventListener('click', handleSendMessage)
        inputArea.appendChild(sendButtonElement)

        injectStyles()
        updateUIState()

        if (autoOpen) {
          console.log('[AuxxChat init] Auto-opening, initiating session...')
          initializeSession()
        } else {
          console.log('[AuxxChat init] AutoOpen is false. Session will initialize on first open.')
        }

        console.log('[AuxxChat init] DOM created successfully.')
      } // End createDOM

      function injectStyles() {
        const existingStyleElement = document.getElementById(`auxx-chat-styles-${widgetId}`)
        if (existingStyleElement) {
          existingStyleElement.parentNode.removeChild(existingStyleElement)
        }
        styleElement = document.createElement('style')
        styleElement.id = `auxx-chat-styles-${widgetId}`
        styleElement.textContent = `
            /* --- AuxxChat Base Styles with CSS Variables --- */
            #${rootElementId} { box-sizing: border-box; }
            #${rootElementId} *, #${rootElementId} *::before, #${rootElementId} *::after { box-sizing: inherit; }
            #${rootElementId} {
              /* --- Variables --- */
              --auxx-chat-primary-color: #4F46E5;
              --auxx-chat-primary-color-rgb: 79, 70, 229;
              --auxx-chat-text-color-primary: #1f2937;
              --auxx-chat-text-color-secondary: #6b7280;
              --auxx-chat-text-color-on-primary: #ffffff;
              --auxx-chat-text-color-error: #dc2626;
              --auxx-chat-text-color-user-message: var(--auxx-chat-text-color-on-primary);
              --auxx-chat-text-color-agent-message: var(--auxx-chat-text-color-primary);
              --auxx-chat-text-color-system-message: var(--auxx-chat-text-color-secondary);
              --auxx-chat-text-color-placeholder: var(--auxx-chat-text-color-secondary);
              --auxx-chat-bg-window: #ffffff;
              --auxx-chat-bg-header: var(--auxx-chat-primary-color);
              --auxx-chat-bg-messages: #f9fafb;
              --auxx-chat-bg-input-area: #ffffff;
              --auxx-chat-bg-input: #ffffff;
              --auxx-chat-bg-input-disabled: #f3f4f6;
              --auxx-chat-bg-message-user: var(--auxx-chat-primary-color);
              --auxx-chat-bg-message-agent: #ffffff;
              --auxx-chat-bg-message-system: #f3f4f6;
              --auxx-chat-bg-error: #fef2f2;
              --auxx-chat-bg-send-button: var(--auxx-chat-primary-color);
              --auxx-chat-bg-chat-button: var(--auxx-chat-primary-color);
              --auxx-chat-border-color-light: #e5e7eb;
              --auxx-chat-border-color-input-focus: var(--auxx-chat-primary-color);
              --auxx-chat-border-color-error: #fecaca;
              --auxx-chat-border-color-message-agent: var(--auxx-chat-border-color-light);
              --auxx-chat-border-color-message-system: var(--auxx-chat-border-color-light);
              --auxx-chat-border-color-input: var(--auxx-chat-border-color-light);
              --auxx-chat-border-color-input-area-top: var(--auxx-chat-border-color-light);
              --auxx-chat-width: 350px;
              --auxx-chat-height: 500px;
              --auxx-chat-position-offset: 20px;
              --auxx-chat-border-radius-window: 12px;
              --auxx-chat-border-radius-button: 50%;
              --auxx-chat-border-radius-message: 18px;
              --auxx-chat-border-radius-message-tail: 4px;
              --auxx-chat-border-radius-input: 24px;
              --auxx-chat-border-radius-send: 24px;
              --auxx-chat-border-radius-logo: 4px;
              --auxx-chat-border-radius-error: 8px;
              --auxx-chat-padding-header: 12px 16px;
              --auxx-chat-padding-messages: 16px;
              --auxx-chat-padding-message: 10px 14px;
              --auxx-chat-padding-message-system: 8px 12px;
              --auxx-chat-padding-info: 8px 12px;
              --auxx-chat-padding-input-area: 12px;
              --auxx-chat-padding-input: 10px 14px;
              --auxx-chat-padding-send-button: 8px 16px;
              --auxx-chat-gap-header-content: 12px;
              --auxx-chat-gap-messages: 12px;
              --auxx-chat-gap-input-area: 8px;
              --auxx-chat-button-size: 60px;
              --auxx-chat-logo-height: 30px;
              --auxx-chat-input-height: 40px;
              --auxx-chat-send-button-height: 40px;
              --auxx-chat-close-button-size: 20px;
              --auxx-chat-close-button-padding: 4px;
              --auxx-chat-font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
              --auxx-chat-font-size-base: 14px;
              --auxx-chat-font-size-title: 16px;
              --auxx-chat-font-size-subtitle: 12px;
              --auxx-chat-font-size-message: var(--auxx-chat-font-size-base);
              --auxx-chat-font-size-message-system: 13px;
              --auxx-chat-font-size-info: 13px;
              --auxx-chat-font-size-input: var(--auxx-chat-font-size-base);
              --auxx-chat-font-size-send-button: var(--auxx-chat-font-size-base);
              --auxx-chat-font-size-chat-button: 24px;
              --auxx-chat-shadow-button: 0 4px 12px rgba(0, 0, 0, 0.15);
              --auxx-chat-shadow-window: 0 5px 20px rgba(0, 0, 0, 0.2);
              --auxx-chat-shadow-input-focus: 0 0 0 2px rgba(var(--auxx-chat-primary-color-rgb), 0.2);
              --auxx-chat-opacity-subtitle: 0.8;
              --auxx-chat-opacity-close-button: 0.8;
              --auxx-chat-opacity-close-button-hover: 1;
              --auxx-chat-opacity-send-button-disabled: 0.6;
              --auxx-chat-opacity-placeholder: 0.8;
              --auxx-chat-brightness-send-button-hover: 90%;
              --auxx-chat-line-height-base: 1.4;
              --auxx-chat-line-height-message: var(--auxx-chat-line-height-base);
              --auxx-chat-line-height-input: var(--auxx-chat-line-height-base);
              --auxx-chat-button-icon: '💬';
              --auxx-chat-close-button-icon: '✕';
              --auxx-chat-scrollbar-width: 6px;
              --auxx-chat-scrollbar-thumb-color: #cbd5e1;
              --auxx-chat-scrollbar-track-color: transparent;
            }
            /* --- Component Styles --- */
            .auxx-chat-button { font-family:var(--auxx-chat-font-family); width:var(--auxx-chat-button-size); height:var(--auxx-chat-button-size); border-radius:var(--auxx-chat-border-radius-button); background-color:var(--auxx-chat-bg-chat-button); color:var(--auxx-chat-text-color-on-primary); font-size:var(--auxx-chat-font-size-chat-button); display:flex; align-items:center; justify-content:center; cursor:pointer; border:none; box-shadow:var(--auxx-chat-shadow-button); transition:transform .2s ease,background-color .2s ease; }
            .auxx-chat-button::before { content:var(--auxx-chat-button-icon); line-height:1; }
            .auxx-chat-button:hover { transform:scale(1.05); }
            .auxx-chat-window { font-family:var(--auxx-chat-font-family); width:var(--auxx-chat-width); height:var(--auxx-chat-height); max-height:90vh; background:var(--auxx-chat-bg-window); border-radius:var(--auxx-chat-border-radius-window); box-shadow:var(--auxx-chat-shadow-window); display:flex; flex-direction:column; overflow:hidden; }
            .auxx-chat-fullscreen { width:100% !important; height:100% !important; max-width:100vw !important; max-height:100vh !important; top:0 !important; left:0 !important; right:0 !important; bottom:0 !important; border-radius:0 !important; --auxx-chat-border-radius-window: 0px; }
            .auxx-chat-header { padding:var(--auxx-chat-padding-header); background-color:var(--auxx-chat-bg-header); color:var(--auxx-chat-text-color-on-primary); display:flex; justify-content:space-between; align-items:center; flex-shrink:0; border-top-left-radius:var(--auxx-chat-border-radius-window); border-top-right-radius:var(--auxx-chat-border-radius-window); transition:background-color .2s ease; }
            .auxx-chat-header-content { display:flex; align-items:center; gap:var(--auxx-chat-gap-header-content); overflow:hidden; flex-grow:1; min-width:0; }
            .auxx-chat-logo { height:var(--auxx-chat-logo-height); width:auto; border-radius:var(--auxx-chat-border-radius-logo); flex-shrink:0; object-fit:contain; }
            .auxx-chat-titles { overflow:hidden; white-space:nowrap; display:flex; flex-direction:column; }
            .auxx-chat-title { margin:0; font-size:var(--auxx-chat-font-size-title); font-weight:600; text-overflow:ellipsis; overflow:hidden; line-height:1.3; color:inherit; }
            .auxx-chat-subtitle { margin:0; font-size:var(--auxx-chat-font-size-subtitle); opacity:var(--auxx-chat-opacity-subtitle); text-overflow:ellipsis; overflow:hidden; line-height:1.2; color:inherit; }
            .auxx-chat-close { background:none; border:none; color:var(--auxx-chat-text-color-on-primary); font-size:var(--auxx-chat-close-button-size); line-height:1; padding:var(--auxx-chat-close-button-padding); cursor:pointer; opacity:var(--auxx-chat-opacity-close-button); transition:opacity .2s; flex-shrink:0; margin-left:8px; border-radius:50%; width:calc(var(--auxx-chat-close-button-size) + 2 * var(--auxx-chat-close-button-padding)); height:calc(var(--auxx-chat-close-button-size) + 2 * var(--auxx-chat-close-button-padding)); display:flex; align-items:center; justify-content:center; }
            .auxx-chat-close::before { content:var(--auxx-chat-close-button-icon); }
            .auxx-chat-close:hover { opacity:var(--auxx-chat-opacity-close-button-hover); }
            .auxx-chat-messages { flex-grow:1; padding:var(--auxx-chat-padding-messages); overflow-y:auto; display:flex; flex-direction:column; gap:var(--auxx-chat-gap-messages); background-color:var(--auxx-chat-bg-messages); overscroll-behavior:contain; -webkit-overflow-scrolling:touch; scrollbar-width:thin; scrollbar-color:var(--auxx-chat-scrollbar-thumb-color) var(--auxx-chat-scrollbar-track-color); }
            .auxx-chat-messages::-webkit-scrollbar { width:var(--auxx-chat-scrollbar-width); }
            .auxx-chat-messages::-webkit-scrollbar-track { background:var(--auxx-chat-scrollbar-track-color); }
            .auxx-chat-messages::-webkit-scrollbar-thumb { background-color:var(--auxx-chat-scrollbar-thumb-color); border-radius:calc(var(--auxx-chat-scrollbar-width) / 2); border:none; }
            .auxx-chat-message { max-width:80%; padding:var(--auxx-chat-padding-message); border-radius:var(--auxx-chat-border-radius-message); position:relative; word-wrap:break-word; overflow-wrap:break-word; line-height:var(--auxx-chat-line-height-message); font-size:var(--auxx-chat-font-size-message); transition:background-color .2s ease,color .2s ease; }
            .auxx-chat-message-user { align-self:flex-end; background-color:var(--auxx-chat-bg-message-user); color:var(--auxx-chat-text-color-user-message); border-bottom-right-radius:var(--auxx-chat-border-radius-message-tail); }
            .auxx-chat-message-agent { align-self:flex-start; background-color:var(--auxx-chat-bg-message-agent); color:var(--auxx-chat-text-color-agent-message); border:1px solid var(--auxx-chat-border-color-message-agent); border-bottom-left-radius:var(--auxx-chat-border-radius-message-tail); }
            .auxx-chat-message-system { align-self:center; background-color:var(--auxx-chat-bg-message-system); color:var(--auxx-chat-text-color-system-message); border:1px solid var(--auxx-chat-border-color-message-system); font-style:italic; font-size:var(--auxx-chat-font-size-message-system); max-width:90%; text-align:center; padding:var(--auxx-chat-padding-message-system); }
            .auxx-chat-message-typing { padding:8px 14px; min-height:calc(var(--auxx-chat-font-size-message) * var(--auxx-chat-line-height-message) + 16px); }
            .auxx-chat-message-typing .auxx-chat-message-content { display:inline-block; position:relative; width:2.5em; height:1em; line-height:1em; text-align:center; }
            .auxx-chat-message-typing .auxx-chat-message-content span { display:inline-block; position:relative; animation:auxx-dot-blink 1.4s infinite both; }
            .auxx-chat-message-typing .auxx-chat-message-content span:nth-child(1) { animation-delay:0s; }
            .auxx-chat-message-typing .auxx-chat-message-content span:nth-child(2) { animation-delay:.2s; }
            .auxx-chat-message-typing .auxx-chat-message-content span:nth-child(3) { animation-delay:.4s; }
            @keyframes auxx-dot-blink { 0%,80%,100% { opacity:0; } 40% { opacity:1; } }
            .auxx-chat-message-status { font-size:.8em; opacity:.7; margin-left:5px; display:inline-block; }
            .auxx-chat-info { text-align:center; padding:var(--auxx-chat-padding-info); margin:8px 0; color:var(--auxx-chat-text-color-secondary); font-size:var(--auxx-chat-font-size-info); }
            .auxx-chat-error-info { color:var(--auxx-chat-text-color-error); background-color:var(--auxx-chat-bg-error); border:1px solid var(--auxx-chat-border-color-error); border-radius:var(--auxx-chat-border-radius-error); font-weight:500; }
            .auxx-chat-input-area { padding:var(--auxx-chat-padding-input-area); border-top:1px solid var(--auxx-chat-border-color-input-area-top); display:flex; gap:var(--auxx-chat-gap-input-area); align-items:flex-end; flex-shrink:0; background-color:var(--auxx-chat-bg-input-area); }
            .auxx-chat-input { flex-grow:1; padding:var(--auxx-chat-padding-input); border:1px solid var(--auxx-chat-border-color-input); border-radius:var(--auxx-chat-border-radius-input); outline:none; font-size:var(--auxx-chat-font-size-input); line-height:var(--auxx-chat-line-height-input); min-height:var(--auxx-chat-input-height); box-sizing:border-box; color:var(--auxx-chat-text-color-primary); background-color:var(--auxx-chat-bg-input); font-family:inherit; transition:border-color .2s ease,box-shadow .2s ease; resize:none; }
            .auxx-chat-input:focus { border-color:var(--auxx-chat-border-color-input-focus); box-shadow:var(--auxx-chat-shadow-input-focus); }
            .auxx-chat-input:disabled { background-color:var(--auxx-chat-bg-input-disabled); cursor:not-allowed; opacity:.7; }
            .auxx-chat-input::placeholder { color:var(--auxx-chat-text-color-placeholder); opacity:var(--auxx-chat-opacity-placeholder); }
            .auxx-chat-send { padding:var(--auxx-chat-padding-send-button); background-color:var(--auxx-chat-bg-send-button); color:var(--auxx-chat-text-color-on-primary); border:none; border-radius:var(--auxx-chat-border-radius-send); font-weight:500; cursor:pointer; transition:background-color .2s,filter .2s,opacity .2s; flex-shrink:0; min-height:var(--auxx-chat-send-button-height); box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-size:var(--auxx-chat-font-size-send-button); font-family:inherit; line-height:1; }
            .auxx-chat-send:hover:not(:disabled) { filter:brightness(var(--auxx-chat-brightness-send-button-hover)); }
            .auxx-chat-send:disabled { opacity:var(--auxx-chat-opacity-send-button-disabled); cursor:not-allowed; filter:none; }
            /* Mobile Styles */
            @media (max-width: 640px) { /* ... */ }
              `
        document.head.appendChild(styleElement)
      }

      // --- Start ---
      try {
        createDOM()
      } catch (e) {
        console.error('[AuxxChat init] Critical Error creating widget DOM:', e)
        if (rootElement) {
          // Try to display error in the designated root
          rootElement.innerHTML = `<p style="color:red; font-family: sans-serif; padding: 10px; border: 1px solid red; background: #fff0f0;">Error loading chat widget: ${e.message}. Please check console.</p>`
        } else {
          // Fallback if rootElement itself failed
          document.body.insertAdjacentHTML(
            'beforeend',
            `<p style="position:fixed; bottom:10px; left:10px; color:red; font-family: sans-serif; padding: 10px; border: 1px solid red; background: #fff0f0; z-index: 10000;">AuxxChat Error: ${e.message}</p>`
          )
        }
      }
    }, // End of init function

    // --- Destroy Function ---
    destroy: (widgetIdOrRootId) => {
      const widgetId = widgetIdOrRootId?.startsWith('auxx-chat-widget-root-')
        ? widgetIdOrRootId.replace('auxx-chat-widget-root-', '')
        : widgetIdOrRootId || 'preview' // Allow passing full ID or just widget ID

      const rootElementId = `auxx-chat-widget-root-${widgetId}`
      const root = document.getElementById(rootElementId)

      if (root) {
        console.log('[AuxxChat destroy] Removing widget root:', rootElementId)
        // --- Disconnect Pusher ---
        // Assuming single instance logic as per original code:
        if (typeof pusher !== 'undefined' && pusher && pusher.disconnect) {
          console.log('[AuxxChat destroy] Disconnecting Pusher')
          try {
            pusher.disconnect()
          } catch (e) {
            console.warn('[AuxxChat destroy] Error disconnecting Pusher:', e)
          }
          // Nullify references (important if init might run again)
          pusher = null
          channel = null
        }

        root.innerHTML = '' // Clear content
        if (root.parentNode) {
          root.parentNode.removeChild(root)
        }
      } else {
        console.warn('[AuxxChat destroy] Widget root not found:', rootElementId)
      }

      // Remove associated styles
      const styleElementId = `auxx-chat-styles-${widgetId}`
      const styleEl = document.getElementById(styleElementId)
      if (styleEl?.parentNode) {
        console.log('[AuxxChat destroy] Removing widget styles:', styleElementId)
        styleEl.parentNode.removeChild(styleEl)
      }

      // --- Clear LocalStorage Data ---
      const LS_KEY_SESSION_ID = `auxx_chat_${widgetId}_session_id`
      const LS_KEY_THREAD_ID = `auxx_chat_${widgetId}_thread_id`
      const LS_KEY_VISITOR_ID = `auxx_chat_${widgetId}_visitor_id`
      console.log('[AuxxChat destroy] Clearing localStorage session data for widget:', widgetId)
      safeLocalStorage.removeItem(LS_KEY_SESSION_ID)
      safeLocalStorage.removeItem(LS_KEY_THREAD_ID)
      safeLocalStorage.removeItem(LS_KEY_VISITOR_ID)
      // Optionally remove the fallback key too if it exists
      // safeLocalStorage.removeItem('auxx_visitor_id');

      console.log('[AuxxChat destroy] Cleanup complete for widget:', widgetId)

      // Reset internal state variables associated with this instance
      isOpen = false // Reset open state
      messages = []
      inputText = ''
      isConnecting = false
      connectionError = null
      isSending = false
      isAgentTyping = false
      isSessionClosed = false // Reset closed state
      sessionId = null
      threadId = null
      visitorId = null
      // Clear DOM references
      chatButton = null
      chatWindow = null
      messageListElement = null
      inputElement = null
      sendButtonElement = null
      typingIndicatorElement = null
      errorInfoElement = null
      connectingInfoElement = null
      rootElement = null
      styleElement = null
    },
  } // End of AuxxChat object

  window.AuxxChat = AuxxChat
  console.log('[AuxxChat Bundle] AuxxChat object exposed to window.')
})(window)
