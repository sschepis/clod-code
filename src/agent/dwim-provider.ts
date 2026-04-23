import type { BaseProvider, StandardChatParams, StandardChatResponse } from '@sschepis/llm-wrapper';

export function createDWIMProvider(provider: BaseProvider): BaseProvider {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'chat') {
        return async function (params: StandardChatParams): Promise<StandardChatResponse> {
          const response = await target.chat(params);
          return interceptResponse(response);
        };
      }
      if (prop === 'stream') {
        return async function* (params: StandardChatParams) {
          const stream = await target.stream(params);
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
