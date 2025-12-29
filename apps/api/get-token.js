// apps/api/get-token.js
// Helper script to get token from keychain

import keytar from '@postman/node-keytar'

async function getToken() {
  try {
    const token = await keytar.getPassword('auxx-cli', 'default')
    if (!token) {
      console.error('❌ No token found. Please run: auxx login')
      process.exit(1)
    }
    const parsed = JSON.parse(token)
    console.log(parsed.access_token)
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

getToken()
