// ~/app/api/widget/styles.css/route.ts
import { NextResponse } from 'next/server'

/**
 * Serves the CSS styles for the widget
 */
export async function GET() {
  try {
    const styles = `
      /* Auxx Chat Widget Styles */
      .auxx-chat-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        position: fixed;
        z-index: 999999;
      }
      
      .auxx-chat-button {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background-color: #4F46E5;
        color: white;
        font-size: 24px;
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        position: fixed;
        bottom: 20px;
        right: 20px;
        transition: all 0.3s ease;
      }
      
      .auxx-chat-button:hover {
        transform: scale(1.05);
      }
      
      .auxx-chat-window {
        position: fixed;
        width: 320px;
        height: 480px;
        background-color: white;
        border-radius: 12px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #E5E7EB;
      }
      
      .auxx-chat-fullscreen {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        border-radius: 0;
      }
      
      .auxx-chat-header {
        background-color: #4F46E5;
        color: white;
        padding: 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .auxx-chat-header-content {
        display: flex;
        align-items: center;
      }
      
      .auxx-chat-logo {
        width: 24px;
        height: 24px;
        margin-right: 8px;
        border-radius: 4px;
      }
      
      .auxx-chat-title {
        font-size: 16px;
        font-weight: 600;
        margin: 0;
      }
      
      .auxx-chat-subtitle {
        font-size: 12px;
        margin: 4px 0 0 0;
        opacity: 0.8;
      }
      
      .auxx-chat-close {
        background: none;
        border: none;
        color: white;
        font-size: 16px;
        cursor: pointer;
        padding: 4px;
      }
      
      .auxx-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .auxx-chat-connecting,
      .auxx-chat-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: #9CA3AF;
        font-size: 14px;
        text-align: center;
        padding: 16px;
      }
      
      .auxx-chat-message {
        max-width: 80%;
        padding: 12px;
        border-radius: 12px;
        position: relative;
      }
      
      .auxx-chat-message-user {
        background-color: #F3F4F6;
        align-self: flex-start;
        border-top-left-radius: 4px;
      }
      
      .auxx-chat-message-agent {
        background-color: #4F46E5;
        color: white;
        align-self: flex-end;
        border-top-right-radius: 4px;
      }
      
      .auxx-chat-message-system {
        background-color: #EFF6FF;
        color: #1E40AF;
        align-self: center;
        text-align: center;
        border-radius: 8px;
      }
      
      .auxx-chat-message-content {
        font-size: 14px;
        line-height: 1.5;
        word-break: break-word;
      }
      
      .auxx-chat-message-time {
        font-size: 10px;
        margin-top: 4px;
        opacity: 0.7;
        text-align: right;
      }
      
      .auxx-chat-input-area {
        display: flex;
        padding: 12px;
        border-top: 1px solid #E5E7EB;
      }
      
      .auxx-chat-input {
        flex: 1;
        border: 1px solid #E5E7EB;
        border-radius: 20px;
        padding: 10px 16px;
        font-size: 14px;
        outline: none;
      }
      
      .auxx-chat-input:focus {
        border-color: #4F46E5;
        box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.2);
      }
      
      .auxx-chat-send {
        background-color: #4F46E5;
        color: white;
        border: none;
        border-radius: 20px;
        padding: 8px 16px;
        margin-left: 8px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .auxx-chat-send:hover {
        opacity: 0.9;
      }
      
      .auxx-chat-send:disabled {
        background-color: #9CA3AF;
        cursor: not-allowed;
      }
      
      /* Mobile responsiveness */
      @media (max-width: 640px) {
        .auxx-chat-window:not(.auxx-chat-fullscreen) {
          width: 280px;
          height: 400px;
        }
      }
    `

    return new NextResponse(styles, {
      headers: {
        'Content-Type': 'text/css',
        'Cache-Control': 'max-age=3600, s-maxage=3600',
      },
    })
  } catch (error) {
    console.error('Error serving styles.css:', error)
    return NextResponse.json({ error: 'Failed to serve styles.css' }, { status: 500 })
  }
}
