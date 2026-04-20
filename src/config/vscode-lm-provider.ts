import * as vscode from 'vscode';
import { BaseProvider, LLMError, LLMErrorCode } from '@sschepis/llm-wrapper';
import type {
  ProviderConfig,
  StandardChatParams,
  StandardChatResponse,
  StandardChatChunk,
  Message,
  ToolDefinition,
} from '@sschepis/llm-wrapper';
import { logger } from '../shared/logger';

/**
 * Adapts the VS Code Language Model API (vscode.lm) into the llm-wrapper
 * BaseProvider interface. This lets Copilot (and any other vscode.lm provider)
 * plug into the existing agent system with zero extra auth.
 */
export class VSCodeLMProvider extends BaseProvider {
  readonly providerName = 'vscode-lm';
  private cachedModels: vscode.LanguageModelChat[] = [];
  private lastModelFetch = 0;

  constructor(config: ProviderConfig) {
    super(config);
  }

  /** List available VS Code language models, with caching. */
  async listModels(): Promise<Array<{ id: string; name: string; vendor: string; family: string; maxInputTokens: number }>> {
    await this.refreshModels();
    return this.cachedModels.map(m => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      family: m.family,
      maxInputTokens: m.maxInputTokens,
    }));
  }

  private async refreshModels(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastModelFetch < 30_000 && this.cachedModels.length > 0) return;
    try {
      this.cachedModels = await vscode.lm.selectChatModels();
      this.lastModelFetch = now;
    } catch (err) {
      logger.warn('Failed to enumerate vscode.lm models', err);
    }
  }

  private async resolveModel(modelId: string): Promise<vscode.LanguageModelChat> {
    await this.refreshModels();

    // Try exact id match first
    let model = this.cachedModels.find(m => m.id === modelId);
    if (model) return model;

    // Try family match (e.g. "gpt-4o" matches family)
    model = this.cachedModels.find(m => m.family === modelId);
    if (model) return model;

    // Try partial match on id or name
    const lower = modelId.toLowerCase();
    model = this.cachedModels.find(m =>
      m.id.toLowerCase().includes(lower) ||
      m.name.toLowerCase().includes(lower) ||
      m.family.toLowerCase().includes(lower)
    );
    if (model) return model;

    // Force refresh and retry
    await this.refreshModels(true);
    model = this.cachedModels.find(m =>
      m.id === modelId ||
      m.family === modelId ||
      m.id.toLowerCase().includes(lower)
    );
    if (model) return model;

    const available = this.cachedModels.map(m => `${m.id} (${m.family})`).join(', ');
    throw new LLMError(
      `Model "${modelId}" not found in VS Code language models. Available: ${available || 'none'}`,
      LLMErrorCode.MODEL_NOT_FOUND,
      this.providerName,
    );
  }

  // ── Message conversion ──────────────────────────────────────────────

  private convertMessages(messages: Message[]): vscode.LanguageModelChatMessage[] {
    const result: vscode.LanguageModelChatMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // VS Code LM has no system role — prepend as a user message
        const text = typeof msg.content === 'string' ? msg.content : this.extractText(msg.content);
        result.push(vscode.LanguageModelChatMessage.User(`[System Instructions]\n${text}`));
        continue;
      }

      if (msg.role === 'tool') {
        const toolCallId = msg.tool_call_id ?? 'unknown';
        const text = typeof msg.content === 'string' ? msg.content : this.extractText(msg.content);
        result.push(vscode.LanguageModelChatMessage.User([
          new vscode.LanguageModelToolResultPart(toolCallId, [
            new vscode.LanguageModelTextPart(text),
          ]),
        ]));
        continue;
      }

      if (msg.role === 'assistant') {
        const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
        const text = typeof msg.content === 'string' ? msg.content : this.extractText(msg.content);
        if (text) {
          parts.push(new vscode.LanguageModelTextPart(text));
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            parts.push(new vscode.LanguageModelToolCallPart(
              tc.id,
              tc.function.name,
              JSON.parse(tc.function.arguments || '{}'),
            ));
          }
        }
        result.push(vscode.LanguageModelChatMessage.Assistant(
          parts.length > 0 ? parts : 'OK',
        ));
        continue;
      }

      // user role
      const text = typeof msg.content === 'string' ? msg.content : this.extractText(msg.content);
      result.push(vscode.LanguageModelChatMessage.User(text || ''));
    }

    return result;
  }

  private extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!content) return '';
    if (Array.isArray(content)) {
      return content
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n');
    }
    return '';
  }

  // ── Tool conversion ─────────────────────────────────────────────────

  private convertTools(tools?: ToolDefinition[]): vscode.LanguageModelChatTool[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      inputSchema: t.function.parameters as object,
    }));
  }

  // ── BaseProvider implementation ─────────────────────────────────────

  protected async doChat(params: StandardChatParams): Promise<StandardChatResponse> {
    const model = await this.resolveModel(params.model);
    const vsMessages = this.convertMessages(params.messages);
    const vsTools = this.convertTools(params.tools);

    const cts = new vscode.CancellationTokenSource();
    const options: vscode.LanguageModelChatRequestOptions = {
      justification: 'Oboto VS agent request',
      tools: vsTools,
      modelOptions: {
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        ...(params.max_tokens !== undefined && { max_tokens: params.max_tokens }),
      },
    };

    const response = await model.sendRequest(vsMessages, options, cts.token);

    let fullText = '';
    const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        fullText += part.value;
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input),
          },
        });
      }
    }

    const estimatedTokens = Math.ceil((fullText.length + JSON.stringify(params.messages).length) / 4);

    return {
      id: `vscode-lm-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model.id,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: fullText || null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      }],
      usage: {
        prompt_tokens: estimatedTokens,
        completion_tokens: Math.ceil(fullText.length / 4),
        total_tokens: estimatedTokens + Math.ceil(fullText.length / 4),
      },
    } as StandardChatResponse;
  }

  protected async *doStream(params: StandardChatParams): AsyncIterable<StandardChatChunk> {
    const model = await this.resolveModel(params.model);
    const vsMessages = this.convertMessages(params.messages);
    const vsTools = this.convertTools(params.tools);

    const cts = new vscode.CancellationTokenSource();
    const options: vscode.LanguageModelChatRequestOptions = {
      justification: 'Oboto VS agent request',
      tools: vsTools,
      modelOptions: {
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        ...(params.max_tokens !== undefined && { max_tokens: params.max_tokens }),
      },
    };

    const response = await model.sendRequest(vsMessages, options, cts.token);
    const streamId = `vscode-lm-${Date.now()}`;
    let index = 0;

    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        yield {
          id: streamId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model.id,
          choices: [{
            index: 0,
            delta: { content: part.value },
            finish_reason: null,
          }],
        } as StandardChatChunk;
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        yield {
          id: streamId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model.id,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: index++,
                id: part.callId,
                type: 'function',
                function: {
                  name: part.name,
                  arguments: JSON.stringify(part.input),
                },
              }],
            },
            finish_reason: null,
          }],
        } as StandardChatChunk;
      }
    }

    // Final chunk with finish_reason
    yield {
      id: streamId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: model.id,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
    } as StandardChatChunk;
  }

  protected mapError(error: unknown): LLMError {
    if (error instanceof vscode.LanguageModelError) {
      if (error.code === 'NoPermissions') {
        return new LLMError(
          `VS Code LM permission denied: ${error.message}`,
          LLMErrorCode.INVALID_API_KEY,
          this.providerName,
          403,
          false,
        );
      }
      if (error.code === 'Blocked') {
        return new LLMError(
          `VS Code LM rate limited: ${error.message}`,
          LLMErrorCode.RATE_LIMIT,
          this.providerName,
          429,
          true,
        );
      }
      if (error.code === 'NotFound') {
        return new LLMError(
          `VS Code LM model not found: ${error.message}`,
          LLMErrorCode.MODEL_NOT_FOUND,
          this.providerName,
          404,
          false,
        );
      }
    }
    const msg = error instanceof Error ? error.message : String(error);
    return new LLMError(
      `VS Code LM error: ${msg}`,
      LLMErrorCode.UNKNOWN,
      this.providerName,
      undefined,
      false,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
