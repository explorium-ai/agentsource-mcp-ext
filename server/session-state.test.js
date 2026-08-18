import assert from "node:assert/strict";
import test from "node:test";

import { SessionStateBridge } from "./session-state.js";

function listStatefulTool(bridge, toolName = "enrich-prospects") {
  bridge.fromClient({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });

  return bridge.fromServer({
    jsonrpc: "2.0",
    id: 1,
    result: {
      tools: [
        {
          name: toolName,
          description: "Enrich an existing dataset.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: { type: "string", description: "Session ID" },
              table_name: { type: "string", description: "Table name" },
            },
            required: ["session_id", "table_name"],
          },
        },
      ],
    },
  });
}

function rememberTextResult(bridge, id, sessionId, tableName) {
  bridge.fromClient({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "fetch-entities", arguments: {} },
  });
  bridge.fromServer({
    jsonrpc: "2.0",
    id,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            session_id: sessionId,
            table_name: tableName,
          }),
        },
      ],
    },
  });
}

test("advertises explicit state-transfer instructions for required-session tools", () => {
  const bridge = new SessionStateBridge();

  const response = listStatefulTool(bridge);
  const [tool] = response.result.tools;

  assert.match(tool.description, /^REQUIRED WORKFLOW STATE:/);
  assert.match(tool.description, /same preceding tool result/);
  assert.match(
    tool.inputSchema.properties.session_id.description,
    /Copy session_id unchanged/,
  );
  assert.match(
    tool.inputSchema.properties.table_name.description,
    /same tool result as session_id/,
  );
});

test("injects an observed session_id when table_name has one unambiguous session", () => {
  const bridge = new SessionStateBridge();
  listStatefulTool(bridge);
  rememberTextResult(bridge, 2, "session_alpha", "prospects_alpha");

  const transformed = bridge.fromClient({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "enrich-prospects",
      arguments: { table_name: "prospects_alpha", enrichments: ["email"] },
    },
  });

  assert.equal(
    transformed.message.params.arguments.session_id,
    "session_alpha",
  );
  assert.deepEqual(transformed.message.params.arguments.enrichments, ["email"]);
});

test("learns session state from structuredContent", () => {
  const bridge = new SessionStateBridge();
  listStatefulTool(bridge);
  bridge.fromClient({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "fetch-entities", arguments: {} },
  });
  bridge.fromServer({
    jsonrpc: "2.0",
    id: 2,
    result: {
      structuredContent: {
        session_id: "session_structured",
        table_name: "prospects_structured",
      },
    },
  });

  const transformed = bridge.fromClient({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "enrich-prospects",
      arguments: { table_name: "prospects_structured" },
    },
  });

  assert.equal(
    transformed.message.params.arguments.session_id,
    "session_structured",
  );
});

test("rejects sessionId instead of silently renaming a client argument", () => {
  const bridge = new SessionStateBridge();
  listStatefulTool(bridge);

  const transformed = bridge.fromClient({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "enrich-prospects",
      arguments: { sessionId: "session_exact", table_name: "prospects_exact" },
    },
  });

  assert.equal(transformed.message, undefined);
  assert.equal(transformed.response.result.isError, true);
  assert.match(transformed.response.result.content[0].text, /used sessionId/);
  assert.match(
    transformed.response.result.content[0].text,
    /required key is session_id/,
  );
});

test("preserves an explicit session_id instead of replacing it", () => {
  const bridge = new SessionStateBridge();
  listStatefulTool(bridge);
  rememberTextResult(bridge, 2, "session_observed", "prospects_shared");

  const transformed = bridge.fromClient({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "enrich-prospects",
      arguments: {
        session_id: "session_explicit",
        table_name: "prospects_shared",
      },
    },
  });

  assert.equal(
    transformed.message.params.arguments.session_id,
    "session_explicit",
  );
});

test("refuses to guess when a table name maps to multiple sessions", () => {
  const bridge = new SessionStateBridge();
  listStatefulTool(bridge);
  rememberTextResult(bridge, 2, "session_first", "prospects_shared");
  rememberTextResult(bridge, 3, "session_second", "prospects_shared");

  const transformed = bridge.fromClient({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "enrich-prospects",
      arguments: { table_name: "prospects_shared" },
    },
  });

  assert.equal(transformed.message, undefined);
  assert.equal(transformed.response.result.isError, true);
  assert.match(
    transformed.response.result.content[0].text,
    /cannot choose safely/,
  );
});

test("returns actionable recovery when no session mapping is available", () => {
  const bridge = new SessionStateBridge();
  listStatefulTool(bridge);

  const transformed = bridge.fromClient({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "enrich-prospects",
      arguments: { table_name: "prospects_unknown" },
    },
  });

  assert.equal(transformed.response.result.isError, true);
  assert.match(transformed.response.result.content[0].text, /was not executed/);
  assert.match(
    transformed.response.result.content[0].text,
    /same result that created or fetched the dataset/,
  );
  assert.match(transformed.response.result.content[0].text, /not sessionId/);
  assert.match(
    transformed.response.result.content[0].text,
    /rerun the source tool/,
  );
});

test("does not learn session state from failed or nested result data", () => {
  const bridge = new SessionStateBridge();
  listStatefulTool(bridge);

  bridge.fromClient({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "fetch-entities", arguments: {} },
  });
  bridge.fromServer({
    jsonrpc: "2.0",
    id: 2,
    result: {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            session_id: "session_failed",
            table_name: "prospects_failed",
          }),
        },
      ],
    },
  });
  bridge.rememberResult({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          preview: [
            { session_id: "session_nested", table_name: "prospects_nested" },
          ],
        }),
      },
    ],
  });

  for (const tableName of ["prospects_failed", "prospects_nested"]) {
    const transformed = bridge.fromClient({
      jsonrpc: "2.0",
      id: tableName,
      method: "tools/call",
      params: {
        name: "enrich-prospects",
        arguments: { table_name: tableName },
      },
    });
    assert.equal(transformed.response.result.isError, true);
  }
});

test("keeps client request correlation separate from reverse-direction messages", () => {
  const bridge = new SessionStateBridge();
  bridge.fromClient({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });
  const serverRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "sampling/createMessage",
    params: {},
  };

  assert.equal(bridge.fromServer(serverRequest), serverRequest);
  const clientResponse = {
    jsonrpc: "2.0",
    id: 1,
    result: { model: "sampled response" },
  };
  assert.equal(bridge.fromClient(clientResponse).message, clientResponse);

  const response = bridge.fromServer({
    jsonrpc: "2.0",
    id: 1,
    result: {
      tools: [
        {
          name: "enrich-prospects",
          inputSchema: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              table_name: { type: "string" },
            },
            required: ["session_id", "table_name"],
          },
        },
      ],
    },
  });

  assert.match(
    response.result.tools[0].description,
    /^REQUIRED WORKFLOW STATE:/,
  );
});

test("passes non-stateful tools and unrelated protocol messages through unchanged", () => {
  const bridge = new SessionStateBridge();
  const call = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "autocomplete",
      arguments: { query: "software companies" },
    },
  };
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  };

  assert.equal(bridge.fromClient(call).message, call);
  assert.equal(bridge.fromClient(notification).message, notification);
  assert.equal(bridge.fromServer(notification), notification);
});
