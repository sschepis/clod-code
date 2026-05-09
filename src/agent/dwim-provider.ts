import type { BaseProvider, StandardChatParams, StandardChatResponse } from '@sschepis/llm-wrapper';

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
  // Make a shallow copy of params and tools array
  const newParams = { ...params };
  newParams.tools = [...params.tools, ...NATIVE_CORE_TOOLS];
  return newParams;
}

export function createDWIMProvider(provider: BaseProvider): BaseProvider {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'chat') {
        return async function (params: StandardChatParams): Promise<StandardChatResponse> {
          const injectedParams = injectNativeTools(params);
          const response = await target.chat(injectedParams);
          return interceptResponse(response);
        };
      }
      if (prop === 'stream') {
        return async function* (params: StandardChatParams) {
          const injectedParams = injectNativeTools(params);
          const stream = await target.stream(injectedParams);
          for await (const chunk of stream) {
            yield interceptChunk(chunk);
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
      choice.message.tool_calls = choice.message.tool_calls.map(transformToolCall);
    }
  }
  return response;
}

function interceptChunk(chunk: any): any {
  if (!chunk.choices) return chunk;
  for (const choice of chunk.choices) {
    if (choice.delta?.tool_calls) {
      choice.delta.tool_calls = choice.delta.tool_calls.map(transformDeltaToolCall);
    }
  }
  return chunk;
}

function transformToolCall(tc: any): any {
  if (tc.type !== 'function' || !tc.function) return tc;
  const name = tc.function.name;
  
  if (name !== 'terminal_interface') {
    // Muscle memory catch: LLM hallucinates native tool name (e.g. file/edit or file_edit)
    const normalizedName = name.replace(/_/g, '/');
    let argsObj = {};
    try {
      argsObj = JSON.parse(tc.function.arguments || '{}');
    } catch (e) {}

    tc.function.name = 'terminal_interface';
    tc.function.arguments = JSON.stringify({
      command: normalizedName,
      kwargs: argsObj
    });
  } else {
    // Muscle memory catch: LLM calls terminal_interface but forgets 'command' or puts args at root
    try {
      const argsObj = JSON.parse(tc.function.arguments || '{}');
      if (!argsObj.command) {
        // Find if there is a command hidden in the args keys
        const command = argsObj.command || argsObj.action || argsObj.module || '';
        if (!command && Object.keys(argsObj).length > 0 && !argsObj.kwargs) {
          // If no command but there are args, this is a malformed tool call. 
          // We can't safely guess the command, but we could try to see if it matches a known command or something.
          // Wait, if there's no command, and no action, maybe we just wrap it into a failed command to throw an error?
          // Actually, if kwargs is missing, we can wrap the root args into kwargs.
        }
        
        if (!argsObj.command && argsObj.kwargs === undefined) {
           // We'll let it fail, but we'll ensure it fails loudly by injecting a non-empty string or something?
           // The backend defaults to root menu if command is missing.
           // To trigger an error, we can set command to "_error_missing_command".
           tc.function.arguments = JSON.stringify({
             command: '_error_missing_command',
             kwargs: argsObj
           });
        }
      }
    } catch(e) {}
  }
  
  return tc;
}

function transformDeltaToolCall(tc: any): any {
  // Delta tool calls stream the name first, then arguments piece by piece.
  // It is very hard to rewrite delta arguments on the fly because they are streaming JSON chunks.
  // However, oboto-agent buffers the stream internally before executing!
  // Wait, does oboto-agent execute off the stream directly? Yes, when the tool_call finish reason arrives.
  // It aggregates chunks via \`aggregateStream\`.
  // So we ONLY need to rewrite the name if it arrives, but wait... if we rewrite the name, we also need to rewrite the arguments JSON string stream. 
  // Rewriting a streaming JSON string from \`{"path": "foo"}\` to \`{"command":"file/write", "kwargs": {"path": "foo"}}\` is practically impossible without buffering.
  // We can just buffer the entire tool call and emit it at the end!
  // But wait! If we just buffer, it breaks streaming.
  
  // Actually, we can just replace `providers.local` with the wrapped provider in `AgentHost`. 
  // Let's check how ObotoAgent handles streaming.
  return tc;
}
