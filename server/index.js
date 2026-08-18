import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";

import { SessionStateBridge } from "./session-state.js";

const REMOTE_MCP_URL = "https://mcp-ext.vibeprospecting.ai/mcp";
const MCP_REMOTE_PATH = fileURLToPath(
  new URL("../node_modules/mcp-remote/dist/proxy.js", import.meta.url),
);

const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined),
);
const localTransport = new StdioServerTransport();
const remoteTransport = new StdioClientTransport({
  command: process.execPath,
  args: [MCP_REMOTE_PATH, REMOTE_MCP_URL],
  env: inheritedEnvironment,
  stderr: "inherit",
});
const sessionState = new SessionStateBridge();
let closing = false;

function reportError(source, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[vibe-prospecting] ${source}: ${message}`);
}

async function closeTransports() {
  if (closing) return;
  closing = true;
  await Promise.allSettled([localTransport.close(), remoteTransport.close()]);
}

localTransport.onmessage = (message) => {
  const transformed = sessionState.fromClient(message);
  const target = transformed.response ? localTransport : remoteTransport;
  const outgoing = transformed.response ?? transformed.message;

  void target.send(outgoing).catch((error) => {
    reportError("message forwarding failed", error);
    void closeTransports();
  });
};

remoteTransport.onmessage = (message) => {
  void localTransport.send(sessionState.fromServer(message)).catch((error) => {
    reportError("response forwarding failed", error);
    void closeTransports();
  });
};

localTransport.onerror = (error) =>
  reportError("Claude transport error", error);
remoteTransport.onerror = (error) =>
  reportError("remote transport error", error);
localTransport.onclose = () => void closeTransports();
remoteTransport.onclose = () => void closeTransports();

process.once("SIGINT", () => void closeTransports());
process.once("SIGTERM", () => void closeTransports());

await remoteTransport.start();
await localTransport.start();
