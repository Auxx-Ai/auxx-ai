// packages/lib/src/ai/mcp/snippet/__tests__/parse-mcp-snippet.test.ts

import { describe, expect, it } from 'vitest'
import { parseMcpSnippet } from '../parse-mcp-snippet'

describe('parseMcpSnippet', () => {
  it('Claude stdio JSON', () => {
    const snippet = JSON.stringify({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      },
    })
    expect(parseMcpSnippet(snippet)).toEqual([
      {
        name: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
    ])
  })

  it('Claude remote JSON with type: streamable-http', () => {
    const snippet = JSON.stringify({
      mcpServers: { acme: { type: 'streamable-http', url: 'https://acme.example/mcp' } },
    })
    expect(parseMcpSnippet(snippet)).toEqual([
      { name: 'acme', url: 'https://acme.example/mcp', transportHint: 'http' },
    ])
  })

  it('bare inner fragment (no wrapper)', () => {
    const snippet = JSON.stringify({ url: 'https://acme.example/mcp' })
    expect(parseMcpSnippet(snippet)).toEqual([{ url: 'https://acme.example/mcp' }])
  })

  it('Cursor remote (url, no type)', () => {
    const snippet = JSON.stringify({ mcpServers: { x: { url: 'https://x.example/mcp' } } })
    expect(parseMcpSnippet(snippet)).toEqual([{ name: 'x', url: 'https://x.example/mcp' }])
  })

  it('Windsurf (serverUrl)', () => {
    const snippet = JSON.stringify({ mcpServers: { w: { serverUrl: 'https://w.example/mcp' } } })
    expect(parseMcpSnippet(snippet)).toEqual([{ name: 'w', url: 'https://w.example/mcp' }])
  })

  it('Gemini (httpUrl forces http)', () => {
    const snippet = JSON.stringify({ mcpServers: { g: { httpUrl: 'https://g.example/mcp' } } })
    expect(parseMcpSnippet(snippet)).toEqual([
      { name: 'g', url: 'https://g.example/mcp', transportHint: 'http' },
    ])
  })

  it('VS Code servers + inputs placeholder', () => {
    const snippet = JSON.stringify({
      servers: {
        v: { url: 'https://v.example/mcp', headers: { Authorization: 'Bearer ${input:token}' } },
      },
      inputs: [{ id: 'token', type: 'promptString' }],
    })
    expect(parseMcpSnippet(snippet)).toEqual([
      {
        name: 'v',
        url: 'https://v.example/mcp',
        headers: { Authorization: 'Bearer ${input:token}' },
        placeholders: ['token'],
      },
    ])
  })

  it('Codex TOML incl. inline env table', () => {
    const snippet = [
      '[mcp_servers.local]',
      'command = "npx"',
      'args = ["-y", "some-pkg"]',
      'env = { API_KEY = "abc", REGION = "us" }',
    ].join('\n')
    expect(parseMcpSnippet(snippet)).toEqual([
      {
        name: 'local',
        command: 'npx',
        args: ['-y', 'some-pkg'],
        env: { API_KEY: 'abc', REGION: 'us' },
      },
    ])
  })

  it('Codex TOML remote with http_headers + bearer_token_env_var', () => {
    const snippet = [
      '[mcp_servers.remote]',
      'url = "https://r.example/mcp"',
      'http_headers = { X-Api-Key = "${API_KEY}" }',
      'bearer_token_env_var = "MY_TOKEN"',
    ].join('\n')
    expect(parseMcpSnippet(snippet)).toEqual([
      {
        name: 'remote',
        url: 'https://r.example/mcp',
        headers: { 'X-Api-Key': '${API_KEY}' },
        placeholders: ['API_KEY', 'MY_TOKEN'],
      },
    ])
  })

  it('claude mcp add --transport http w/ two --header flags', () => {
    const snippet =
      'claude mcp add --transport http acme https://acme.example/mcp --header "X-Api-Key: abc" --header "X-Org: 42"'
    expect(parseMcpSnippet(snippet)).toEqual([
      {
        name: 'acme',
        url: 'https://acme.example/mcp',
        headers: { 'X-Api-Key': 'abc', 'X-Org': '42' },
        transportHint: 'http',
      },
    ])
  })

  it('claude mcp add ... -- npx -y pkg', () => {
    const snippet = 'claude mcp add myserver -- npx -y some-pkg@latest'
    expect(parseMcpSnippet(snippet)).toEqual([
      { name: 'myserver', command: 'npx', args: ['-y', 'some-pkg@latest'] },
    ])
  })

  it('claude mcp add-json', () => {
    const snippet = `claude mcp add-json acme '{"url":"https://acme.example/mcp"}'`
    expect(parseMcpSnippet(snippet)).toEqual([{ name: 'acme', url: 'https://acme.example/mcp' }])
  })

  it('add-json with a nested oauth object + invalid `\\_` escape + trailing --scope', () => {
    const snippet =
      'claude mcp add-json meister \'{"type":"http","url":"https://mcp.mindmeister.com/mcp","oauth":{"clientId":"I2c15pEw18co\\_aBF1o1Posv","callbackPort":18920}}\' --scope user'
    expect(parseMcpSnippet(snippet)).toEqual([
      { name: 'meister', url: 'https://mcp.mindmeister.com/mcp', transportHint: 'http' },
    ])
  })

  it('codex mcp add ... -- npx', () => {
    const snippet = 'codex mcp add ctx --env API_KEY=secret -- npx -y @upstash/context7-mcp'
    expect(parseMcpSnippet(snippet)).toEqual([
      {
        name: 'ctx',
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
        env: { API_KEY: 'secret' },
      },
    ])
  })

  it('gemini mcp add -t http', () => {
    const snippet =
      'gemini mcp add -t http acme https://acme.example/mcp -H "Authorization: Bearer xyz"'
    expect(parseMcpSnippet(snippet)).toEqual([
      {
        name: 'acme',
        url: 'https://acme.example/mcp',
        headers: { Authorization: 'Bearer xyz' },
        transportHint: 'http',
      },
    ])
  })

  it('cursor:// deeplink (base64)', () => {
    const config = Buffer.from(JSON.stringify({ url: 'https://acme.example/mcp' })).toString(
      'base64'
    )
    const snippet = `cursor://anysphere.cursor-mcp/install?name=acme&config=${encodeURIComponent(config)}`
    expect(parseMcpSnippet(snippet)).toEqual([{ name: 'acme', url: 'https://acme.example/mcp' }])
  })

  it('vscode:mcp/install deeplink', () => {
    const json = JSON.stringify({ name: 'acme', url: 'https://acme.example/mcp' })
    const snippet = `vscode:mcp/install?${encodeURIComponent(json)}`
    expect(parseMcpSnippet(snippet)).toEqual([{ name: 'acme', url: 'https://acme.example/mcp' }])
  })

  it('mcp-remote unwrap (URL + port + --header + no-space header variant)', () => {
    const snippet = JSON.stringify({
      mcpServers: {
        linear: {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            'https://mcp.linear.app/sse',
            '8080',
            '--header',
            'X-Api-Key: abc',
            '--header',
            'Authorization:${TOKEN}',
            '--transport',
            'sse-only',
          ],
        },
      },
    })
    expect(parseMcpSnippet(snippet)).toEqual([
      {
        name: 'linear',
        url: 'https://mcp.linear.app/sse',
        headers: { 'X-Api-Key': 'abc', Authorization: '${TOKEN}' },
        transportHint: 'sse',
        placeholders: ['TOKEN'],
      },
    ])
  })

  it('bare URL', () => {
    expect(parseMcpSnippet('https://acme.example/mcp')).toEqual([
      { url: 'https://acme.example/mcp' },
    ])
  })

  it('multi-server mcpServers block', () => {
    const snippet = JSON.stringify({
      mcpServers: {
        a: { url: 'https://a.example/mcp' },
        b: { command: 'npx', args: ['-y', 'b-pkg'] },
      },
    })
    expect(parseMcpSnippet(snippet)).toEqual([
      { name: 'a', url: 'https://a.example/mcp' },
      { name: 'b', command: 'npx', args: ['-y', 'b-pkg'] },
    ])
  })

  it('markdown-fenced paste', () => {
    const snippet = '```json\n' + JSON.stringify({ url: 'https://acme.example/mcp' }) + '\n```'
    expect(parseMcpSnippet(snippet)).toEqual([{ url: 'https://acme.example/mcp' }])
  })

  it('garbage → []', () => {
    expect(parseMcpSnippet('hello world this is not a config')).toEqual([])
    expect(parseMcpSnippet('')).toEqual([])
  })
})
