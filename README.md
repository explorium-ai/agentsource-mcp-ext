# Explorium MCP Extension for Claude Desktop

This Desktop Extension (DXT) connects Claude Desktop to your existing Explorium SSE MCP server at `https://mcp-auth.explorium.ai/sse` using `mcp-remote` as a proxy.

## What this extension does

The extension uses `mcp-remote` to proxy MCP protocol requests between Claude Desktop and your Explorium SSE server, allowing you to:
- Search for companies using various criteria
- Search for contacts/people
- Get detailed company and contact information
- Access live company and contact data through your existing API

## Directory Structure

```
explorium-mcp-extension/
├── manifest.json          # DXT extension configuration
├── package.json          # Node.js dependencies (includes mcp-remote)
├── server/
│   └── index.js          # Proxy server using mcp-remote
├── assets/
│   └── explorium_logo.jpeg  # Extension icon
└── README.md             # This file
```

## How it works

1. Claude Desktop launches the Node.js server (`server/index.js`)
2. The server spawns `mcp-remote` with SSE transport configuration
3. `mcp-remote` connects to your SSE server at `https://mcp-auth.explorium.ai/sse`
4. Authentication is handled via Bearer token in the Authorization header
5. All MCP protocol messages are proxied between Claude Desktop and your SSE server

## Building the Extension

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Install the DXT CLI:**
   ```bash
   npm install -g @anthropic-ai/dxt
   ```

3. **Validate the manifest:**
   ```bash
   dxt validate manifest.json
   ```

4. **Pack the extension:**
   ```bash
   dxt pack . explorium-mcp-extension.dxt
   ```

## Installation

1. Open Claude Desktop
2. Go to Settings > Extensions
3. Click "Install from file"
4. Select the `explorium-mcp-extension.dxt` file
5. Enter your Explorium API key when prompted

## Configuration

The extension requires:
- **API Key**: Your Explorium API key for authentication

The extension will automatically:
- Use `mcp-remote` to connect to your SSE server at `https://mcp-auth.explorium.ai/sse`
- Set the Authorization header with your API key
- Handle all MCP protocol communication transparently

## Troubleshooting

If you're getting connection issues:

1. **Check your API key**: Ensure it's valid and has the correct permissions
2. **Verify SSE server**: Make sure `https://mcp-auth.explorium.ai/sse` is accessible
3. **Check logs**: Look at the Claude Desktop logs for detailed error messages
4. **Test manually**: You can test the mcp-remote connection directly:
   ```bash
   npx mcp-remote sse http://mcp-auth.explorium.ai/sse --header "Authorization: Bearer YOUR_API_KEY"
   ```

## mcp-remote Command

The extension effectively runs:
```bash
mcp-remote sse http://mcp-auth.explorium.ai/sse \
  --header "Authorization: Bearer YOUR_API_KEY" \
  --header "Content-Type: application/json"
```

This creates a bidirectional proxy between Claude Desktop (stdio) and your SSE server.