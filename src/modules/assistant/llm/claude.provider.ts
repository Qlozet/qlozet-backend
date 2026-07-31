import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  LlmMessage,
  LlmProvider,
  RunToolLoopInput,
  RunToolLoopResult,
  RunToolLoopStreamInput,
} from './llm-provider.interface';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Claude implementation of LlmProvider using the Anthropic Messages API over the
 * shared HttpService. Runs the tool-use loop server-side and returns the final
 * text. The system prompt is sent as a cacheable block to cut per-turn cost.
 */
@Injectable()
export class ClaudeProvider implements LlmProvider {
  private readonly logger = new Logger(ClaudeProvider.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private get apiKey(): string {
    const key = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'The assistant is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    return key;
  }

  private async postMessages(body: Record<string, any>): Promise<any> {
    try {
      const resp = await firstValueFrom(
        this.httpService.post(ANTHROPIC_URL, body, {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          timeout: 60_000,
        }),
      );
      return resp.data;
    } catch (err: any) {
      const detail =
        err?.response?.data?.error?.message ?? err?.message ?? 'unknown error';
      this.logger.error(`Anthropic request failed: ${detail}`);
      throw new ServiceUnavailableException(
        'The assistant is temporarily unavailable. Please try again.',
      );
    }
  }

  // System prompt as a cacheable text block (prompt caching cuts repeat cost).
  private systemBlocks(system: string) {
    return [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ];
  }

  // Pull the real Anthropic error message out of an axios error. On streaming
  // requests the error body is itself a stream, so a plain `.data.error.message`
  // read comes back empty — drain the stream to recover the actual reason.
  private async extractAnthropicError(err: any): Promise<string> {
    try {
      const data = err?.response?.data;
      if (data && typeof data.on === 'function') {
        const chunks: Buffer[] = [];
        for await (const c of data) chunks.push(Buffer.from(c));
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          return JSON.parse(body)?.error?.message ?? body;
        } catch {
          return body;
        }
      }
      return (
        data?.error?.message ?? err?.message ?? 'unknown error'
      );
    } catch {
      return err?.message ?? 'unknown error';
    }
  }

  async runToolLoop(input: RunToolLoopInput): Promise<RunToolLoopResult> {
    const maxTurns = input.maxTurns ?? 6;
    const maxTokens = input.maxTokens ?? 1024;

    // Convert stored history (plain text) into API message blocks.
    const conversation: any[] = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const toolsUsed: string[] = [];
    let lastUsage: any = null;

    for (let turn = 0; turn < maxTurns; turn++) {
      const data = await this.postMessages({
        model: input.model,
        max_tokens: maxTokens,
        system: this.systemBlocks(input.system),
        tools: input.tools,
        messages: conversation,
      });

      lastUsage = data?.usage ?? lastUsage;
      const content: any[] = data?.content ?? [];
      conversation.push({ role: 'assistant', content });

      const toolUses = content.filter((b) => b?.type === 'tool_use');

      if (data?.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const text = content
          .filter((b) => b?.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return { text, toolsUsed, usage: lastUsage };
      }

      // Execute every requested tool and feed results back.
      const results: any[] = [];
      for (const tu of toolUses) {
        toolsUsed.push(tu.name);
        let result: any;
        try {
          result = await input.onToolCall(tu.name, tu.input ?? {});
        } catch (e: any) {
          result = { error: e?.message ?? 'tool failed' };
        }
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      conversation.push({ role: 'user', content: results });
    }

    this.logger.warn(`Tool loop hit maxTurns (${maxTurns}) without finishing.`);
    return {
      text: "I couldn't finish analysing that in time. Try narrowing the question.",
      toolsUsed,
      usage: lastUsage,
    };
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  private async postStream(body: Record<string, any>): Promise<any> {
    const resp = await firstValueFrom(
      this.httpService.post(
        ANTHROPIC_URL,
        { ...body, stream: true },
        {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          responseType: 'stream',
          timeout: 120_000,
        },
      ),
    );
    return resp.data; // Node Readable of SSE bytes
  }

  /**
   * Stream a single assistant turn, emitting text tokens via onDelta. Rebuilds
   * the turn's content blocks (text + tool_use) so the caller can feed tool
   * results back and continue the loop.
   */
  private async streamOneTurn(
    body: Record<string, any>,
    onDelta: (t: string) => void,
  ): Promise<{
    content: any[];
    stopReason: string | null;
    usage: any;
    turnText: string;
  }> {
    let stream: any;
    try {
      stream = await this.postStream(body);
    } catch (err: any) {
      const detail = await this.extractAnthropicError(err);
      this.logger.error(
        `Anthropic stream request failed (model=${body?.model}): ${detail}`,
      );
      throw new ServiceUnavailableException(
        'The assistant is temporarily unavailable. Please try again.',
      );
    }

    const blocks: Record<number, any> = {};
    let stopReason: string | null = null;
    let usage: any = null;
    let turnText = '';
    let buffer = '';

    const handleEvent = (evt: any) => {
      switch (evt?.type) {
        case 'content_block_start':
          blocks[evt.index] = {
            ...evt.content_block,
            _json: '',
          };
          break;
        case 'content_block_delta': {
          const b = blocks[evt.index];
          if (!b) break;
          if (evt.delta?.type === 'text_delta') {
            b.text = (b.text ?? '') + evt.delta.text;
            turnText += evt.delta.text;
            onDelta(evt.delta.text);
          } else if (evt.delta?.type === 'input_json_delta') {
            b._json += evt.delta.partial_json ?? '';
          }
          break;
        }
        case 'message_delta':
          if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
          if (evt.usage) usage = { ...(usage ?? {}), ...evt.usage };
          break;
        case 'message_start':
          if (evt.message?.usage) usage = evt.message.usage;
          break;
        default:
          break;
      }
    };

    for await (const chunk of stream) {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json || json === '[DONE]') continue;
        try {
          handleEvent(JSON.parse(json));
        } catch {
          /* ignore malformed SSE fragment */
        }
      }
    }

    // Assemble the API-shaped content array for the next request.
    const content = Object.keys(blocks)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => {
        const b = blocks[Number(k)];
        if (b.type === 'tool_use') {
          let input = {};
          try {
            input = b._json ? JSON.parse(b._json) : {};
          } catch {
            input = {};
          }
          return { type: 'tool_use', id: b.id, name: b.name, input };
        }
        return { type: 'text', text: b.text ?? '' };
      });

    return { content, stopReason, usage, turnText };
  }

  async runToolLoopStream(
    input: RunToolLoopStreamInput,
  ): Promise<RunToolLoopResult> {
    const maxTurns = input.maxTurns ?? 6;
    const maxTokens = input.maxTokens ?? 1024;

    const conversation: any[] = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const toolsUsed: string[] = [];
    let lastUsage: any = null;
    let finalText = '';

    for (let turn = 0; turn < maxTurns; turn++) {
      const { content, stopReason, usage, turnText } = await this.streamOneTurn(
        {
          model: input.model,
          max_tokens: maxTokens,
          system: this.systemBlocks(input.system),
          tools: input.tools,
          messages: conversation,
        },
        input.onDelta,
      );

      lastUsage = usage ?? lastUsage;
      conversation.push({ role: 'assistant', content });

      const toolUses = content.filter((b) => b?.type === 'tool_use');
      if (stopReason !== 'tool_use' || toolUses.length === 0) {
        finalText = turnText.trim() || finalText;
        return { text: finalText, toolsUsed, usage: lastUsage };
      }

      const results: any[] = [];
      for (const tu of toolUses) {
        toolsUsed.push(tu.name);
        let result: any;
        try {
          result = await input.onToolCall(tu.name, tu.input ?? {});
        } catch (e: any) {
          result = { error: e?.message ?? 'tool failed' };
        }
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      conversation.push({ role: 'user', content: results });
    }

    this.logger.warn(`Stream loop hit maxTurns (${maxTurns}) without finishing.`);
    return {
      text:
        finalText ||
        "I couldn't finish analysing that in time. Try narrowing the question.",
      toolsUsed,
      usage: lastUsage,
    };
  }

  async complete(input: {
    system: string;
    messages: LlmMessage[];
    model: string;
    maxTokens?: number;
  }): Promise<RunToolLoopResult> {
    const data = await this.postMessages({
      model: input.model,
      max_tokens: input.maxTokens ?? 512,
      system: this.systemBlocks(input.system),
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });
    const text = (data?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim();
    return { text, toolsUsed: [], usage: data?.usage ?? null };
  }
}
