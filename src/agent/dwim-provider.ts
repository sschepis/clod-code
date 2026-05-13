import type { BaseProvider, StandardChatParams, StandardChatResponse } from '@sschepis/llm-wrapper';
import { logger } from '../shared/logger';

const NATIVE_TOOL_MAP: Record<string, string> = {
  code_explore: 'code/explore',
  file_read: 'file/read',
  file_edit: 'file/edit',
  search_grep: 'search/grep',
  shell_run: 'shell/run',
};

const REVERSE_MAP: Record<string, string> = {};
for (const [native, slashed] of Object.entries(NATIVE_TOOL_MAP)) {
  REVERSE_MAP[slashed] = native;
}

const NATIVE_CORE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'code_explore',
      description: 'Semantic code intelligence via VS Code language servers. ALWAYS use code/explore as your FIRST tool when investigating any code area. It returns symbols, type info, definitions, and call hierarchy in a single call.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to file to explore' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'file_read',
      description: 'Read the contents of a file. Supports offset and limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read' },
          offset: { type: 'number', description: 'Line number to start reading from' },
          limit: { type: 'number', description: 'Number of lines to read' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'file_edit',
      description: 'Surgical file editing. Use for targeted changes instead of rewriting the whole file. Provide an array of edits.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string', description: 'Exact string to replace. Must match the file content perfectly.' },
                new_string: { type: 'string', description: 'The new string to insert' }
              },
              required: ['old_string', 'new_string']
            }
          }
        },
        required: ['path', 'edits']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_grep',
      description: 'Search for text patterns inside files using regex. Best for finding literals and non-semantic code patterns.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to search in' },
          pattern: { type: 'string', description: 'Regex pattern to search for' }
        },
        required: ['path', 'pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'shell_run',
      description: 'Execute a shell command and return its output. Good for builds, tests, and CLI tasks.',
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string', description: 'Shell command to run' },
          cwd: { type: 'string', description: 'Working directory for the command' }
        },
        required: ['cmd']
      }
    }
  }
];

function injectNativeTools(params: StandardChatParams): StandardChatParams {
  if (!params.tools) return params;
  const newParams = { ...params };
  newParams.tools = [...params.tools, ...NATIVE_CORE_TOOLS];
  return newParams;
}

/**
 * Rewrite tool calls from native names (code_explore, file_read, etc.)
 * into the terminal_interface command/kwargs format that oboto-agent's
 * swiss-army-tool router expects — but KEEP the original native name
 * on `tc.function.name` so that the Gemini conversation history stays
 * consistent with the function declarations.
 */
function rewriteToolCallForDispatch(tc: any): any {
  if (tc.type !== 'function' || !tc.function) return tc;
  const name = tc.function.name;
  const command = NATIVE_TOOL_MAP[name] || name.replace(/_/g, '/');

  if (name !== 'terminal_interface' && name in NATIVE_TOOL_MAP) {
    let argsObj = {};
    try { argsObj = JSON.parse(tc.function.arguments || '{}'); } catch {}
    tc.function.arguments = JSON.stringify({ command, kwargs: argsObj });
    // Keep tc.function.name as the native name — Gemini needs it to match
    // the function declarations. oboto-agent reads `command` from the
    // parsed arguments via normalizeToolArgs.
    tc.function.name = 'terminal_interface';
  } else if (name === 'terminal_interface') {
    try {
      const argsObj = JSON.parse(tc.function.arguments || '{}');
      if (!argsObj.command && argsObj.kwargs === undefined) {
        tc.function.arguments = JSON.stringify({
          command: '_error_missing_command',
          kwargs: argsObj
        });
      }
    } catch {}
  }
  return tc;
}

/**
 * Before sending messages to the LLM, restore native tool names in any
 * previous assistant messages whose tool_calls were rewritten to
 * terminal_interface. This keeps the function declarations and the
 * conversation history in sync for the Gemini API.
 */
function restoreNativeNamesInHistory(params: StandardChatParams): StandardChatParams {
  if (!params.messages) return params;

  const newMessages = params.messages.map((msg: any) => {
    if (msg.role !== 'assistant' || !msg.tool_calls) return msg;
    const newToolCalls = msg.tool_calls.map((tc: any) => {
      if (tc.function?.name !== 'terminal_interface') return tc;
      try {
        const args = JSON.parse(tc.function.arguments || '{}');
        const command = args.command;
        const nativeName = REVERSE_MAP[command];
        if (nativeName) {
          return {
            ...tc,
            function: {
              ...tc.function,
              name: nativeName,
              arguments: JSON.stringify(args.kwargs || {})
            }
          };
        }
      } catch {}
      return tc;
    });
    return { ...msg, tool_calls: newToolCalls };
  });

  // Also fix tool result messages: their `name` must match the
  // assistant's tool call name.
  const tcNameById = new Map<string, string>();
  for (const msg of newMessages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        tcNameById.set(tc.id, tc.function.name);
      }
    }
  }

  const finalMessages = newMessages.map((msg: any) => {
    if (msg.role !== 'tool') return msg;
    const correctName = tcNameById.get(msg.tool_call_id);
    if (correctName && msg.name !== correctName) {
      return { ...msg, name: correctName };
    }
    return msg;
  });

  return { ...params, messages: finalMessages };
}

export function createDWIMProvider(provider: BaseProvider): BaseProvider {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'chat') {
        return async function (params: StandardChatParams): Promise<StandardChatResponse> {
          const prepared = restoreNativeNamesInHistory(injectNativeTools(params));
          const response = await target.chat(prepared);
          return interceptResponse(response);
        };
      }
      if (prop === 'stream') {
        return async function* (params: StandardChatParams) {
          const prepared = restoreNativeNamesInHistory(injectNativeTools(params));
          const stream = target.stream(prepared);
          // Accumulate tool call fragments so we can rewrite the complete
          // tool calls for dispatch while streaming text through immediately.
          const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();
          let hasNativeToolCalls = false;
          let lastId = '';
          let lastCreated = 0;
          let lastModel = '';
          for await (const chunk of stream) {
            if (!lastId && chunk.id) lastId = chunk.id;
            if (!lastModel && chunk.model) lastModel = chunk.model;
            if (!lastCreated && chunk.created) lastCreated = chunk.created;
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              yield chunk;
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = toolCallAccum.get(tc.index);
                if (existing) {
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                } else {
                  toolCallAccum.set(tc.index, {
                    id: tc.id ?? '',
                    name: tc.function?.name ?? '',
                    args: tc.function?.arguments ?? '',
                  });
                }
                if (tc.function?.name && tc.function.name in NATIVE_TOOL_MAP) {
                  hasNativeToolCalls = true;
                }
              }
              if (!hasNativeToolCalls) {
                yield chunk;
              }
            }
            if (!delta?.content && !delta?.tool_calls) {
              yield chunk;
            }
          }
          // Emit fully assembled and rewritten tool calls for dispatch
          if (hasNativeToolCalls && toolCallAccum.size > 0) {
            const rewrittenToolCalls: any[] = [];
            for (const [index, tc] of [...toolCallAccum.entries()].sort((a, b) => a[0] - b[0])) {
              rewrittenToolCalls.push(rewriteToolCallForDispatch({
                id: tc.id,
                index,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.args },
              }));
            }
            yield {
              id: lastId,
              object: 'chat.completion.chunk',
              created: lastCreated,
              model: lastModel,
              choices: [{
                index: 0,
                delta: { tool_calls: rewrittenToolCalls },
                finish_reason: 'tool_calls'
              }]
            };
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}

function interceptResponse(response: StandardChatResponse): StandardChatResponse {
  if (!response.choices) return response;
  for (const choice of response.choices) {
    if (choice.message?.tool_calls) {
      choice.message.tool_calls = choice.message.tool_calls.map(rewriteToolCallForDispatch);
    }
  }
  return response;
}
