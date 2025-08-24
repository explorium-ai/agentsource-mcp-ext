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
ENV API_ACCESS_TOKEN=your-api-access-token-here

EXPOSE 44280

# Start the application, expanding API_ACCESS_TOKEN at runtime
ENTRYPOINT [ "sh", "-c", "npx mcp-remote https://mcp-docker-registry.explorium.ai/mcp --header \"Authorization: Bearer ${API_ACCESS_TOKEN}\"" ]
