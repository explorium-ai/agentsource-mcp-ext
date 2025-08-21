FROM node:22-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install dependencies
RUN --mount=type=cache,target=/root/.npm npm ci --only=production

# Copy the rest of the application
COPY server/ ./server/
COPY manifest.json logo.png ./

# Set environment to production
ENV NODE_ENV=production

# Start the application using MCP remote
ENTRYPOINT ["node", "node_modules/mcp-remote/dist/proxy.js", "https://mcp-docker-registry.explorium.ai/mcp"]