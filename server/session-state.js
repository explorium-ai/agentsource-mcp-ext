const REQUIRED_STATE_MARKER = "REQUIRED WORKFLOW STATE:";

const SESSION_DESCRIPTION =
  "Required runtime identifier for an existing dataset. Copy session_id unchanged from the same tool result as table_name. Never omit, rename, modify, or invent it.";

const TABLE_DESCRIPTION =
  "Dataset table identifier. Copy table_name unchanged from the same tool result as session_id. Never combine values from different results.";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasMessageId(message) {
  return isObject(message) && message.id !== undefined && message.id !== null;
}

function isRequestMessage(message) {
  return hasMessageId(message) && typeof message.method === "string";
}

function isResponseMessage(message) {
  return (
    hasMessageId(message) &&
    message.method === undefined &&
    (message.result !== undefined || message.error !== undefined)
  );
}

function parseJsonText(text) {
  if (typeof text !== "string") return null;

  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function getSessionTablePair(value) {
  if (
    isObject(value) &&
    typeof value.session_id === "string" &&
    value.session_id.startsWith("session_") &&
    typeof value.table_name === "string" &&
    value.table_name.length > 0
  ) {
    return { sessionId: value.session_id, tableName: value.table_name };
  }

  return null;
}

function annotateStatefulTool(tool) {
  if (!isObject(tool) || !isObject(tool.inputSchema)) return tool;

  const required = Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required
    : [];
  if (!required.includes("session_id") || !required.includes("table_name"))
    return tool;

  const guidance = `${REQUIRED_STATE_MARKER}\nCopy both session_id and table_name unchanged from the same preceding tool result. Never invent either value. This tool does not create a session.`;
  const description =
    typeof tool.description === "string" ? tool.description : "";
  const properties = isObject(tool.inputSchema.properties)
    ? tool.inputSchema.properties
    : {};
  const sessionSchema = isObject(properties.session_id)
    ? properties.session_id
    : {};
  const tableSchema = isObject(properties.table_name)
    ? properties.table_name
    : null;

  return {
    ...tool,
    description: description.startsWith(REQUIRED_STATE_MARKER)
      ? description
      : `${guidance}${description ? `\n\n${description}` : ""}`,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...properties,
        session_id: {
          ...sessionSchema,
          description: SESSION_DESCRIPTION,
        },
        ...(tableSchema
          ? {
              table_name: {
                ...tableSchema,
                description: TABLE_DESCRIPTION,
              },
            }
          : {}),
      },
    },
  };
}

function missingSessionResponse(request, reason) {
  const toolName = request.params.name;
  let suffix =
    "The extension has not observed an unambiguous session_id for this table.";
  if (reason === "wrong-key") {
    suffix = "The request used sessionId, but the required key is session_id.";
  } else if (reason === "ambiguous") {
    suffix =
      "Multiple observed sessions contain this table name, so the extension cannot choose safely.";
  }

  return {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      isError: true,
      content: [
        {
          type: "text",
          text: `${toolName} was not executed. Required argument session_id is missing. ${suffix} Copy both session_id and table_name unchanged from the same result that created or fetched the dataset, then retry. Use the exact key session_id, not sessionId. Do not invent a value. If the source result is unavailable, rerun the source tool.`,
        },
      ],
    },
  };
}

export class SessionStateBridge {
  constructor() {
    this.pendingRequests = new Map();
    this.requiredSessionTools = new Set();
    this.sessionsByTable = new Map();
  }

  fromClient(message) {
    if (!isObject(message)) return { message };

    if (isRequestMessage(message)) {
      this.pendingRequests.set(message.id, message);
    }

    if (message.method !== "tools/call" || !isObject(message.params)) {
      return { message };
    }

    const toolName = message.params.name;
    if (
      typeof toolName !== "string" ||
      !this.requiredSessionTools.has(toolName)
    ) {
      return { message };
    }

    const originalArguments = isObject(message.params.arguments)
      ? message.params.arguments
      : {};
    const args = { ...originalArguments };

    if (args.session_id === undefined && args.sessionId !== undefined) {
      if (hasMessageId(message)) {
        this.pendingRequests.delete(message.id);
        return { response: missingSessionResponse(message, "wrong-key") };
      }
      return { message };
    }

    if (args.session_id !== undefined) {
      return {
        message: {
          ...message,
          params: { ...message.params, arguments: args },
        },
      };
    }

    const tableName =
      typeof args.table_name === "string" ? args.table_name : null;
    const sessions = tableName
      ? this.sessionsByTable.get(tableName)
      : undefined;

    if (sessions?.size === 1) {
      args.session_id = sessions.values().next().value;
      return {
        message: {
          ...message,
          params: { ...message.params, arguments: args },
        },
      };
    }

    if (hasMessageId(message)) {
      this.pendingRequests.delete(message.id);
      return {
        response: missingSessionResponse(
          message,
          sessions && sessions.size > 1 ? "ambiguous" : "unknown",
        ),
      };
    }

    return { message };
  }

  fromServer(message) {
    if (!isResponseMessage(message)) return message;

    const request = this.pendingRequests.get(message.id);
    if (!request) return message;
    this.pendingRequests.delete(message.id);

    if (
      request.method === "tools/list" &&
      isObject(message.result) &&
      Array.isArray(message.result.tools)
    ) {
      if (!request.params?.cursor) this.requiredSessionTools.clear();

      const tools = message.result.tools.map((tool) => {
        const annotated = annotateStatefulTool(tool);
        if (annotated !== tool && typeof tool.name === "string") {
          this.requiredSessionTools.add(tool.name);
        }
        return annotated;
      });

      return {
        ...message,
        result: { ...message.result, tools },
      };
    }

    if (
      request.method === "tools/call" &&
      isObject(message.result) &&
      message.result.isError !== true
    ) {
      this.rememberResult(message.result);
    }

    return message;
  }

  rememberResult(result) {
    const candidates = [];

    if (isObject(result.structuredContent)) {
      candidates.push(result.structuredContent);
    }

    if (Array.isArray(result.content)) {
      for (const content of result.content) {
        if (isObject(content) && content.type === "text") {
          const parsed = parseJsonText(content.text);
          if (parsed !== null) candidates.push(parsed);
        }
      }
    }

    for (const candidate of candidates) {
      const pair = getSessionTablePair(candidate);
      if (!pair) continue;

      const sessions = this.sessionsByTable.get(pair.tableName) ?? new Set();
      sessions.add(pair.sessionId);
      this.sessionsByTable.set(pair.tableName, sessions);
    }
  }
}
