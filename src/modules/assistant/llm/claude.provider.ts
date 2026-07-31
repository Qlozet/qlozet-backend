import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  LlmMessage,
  LlmProvider,
  RunToolLoopInput,
  RunToolLoopResult,
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
