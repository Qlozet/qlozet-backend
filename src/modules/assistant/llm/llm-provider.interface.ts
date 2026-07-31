/**
 * Provider-agnostic LLM contract. The assistant orchestration, tools, and
 * prompts depend ONLY on this — never on a vendor SDK — so Claude can be swapped
 * for another provider (or a separate service) without touching business logic.
 */

export interface LlmToolDef {
  name: string;
  description: string;
  // JSON Schema for the tool's arguments.
  input_schema: Record<string, any>;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  // Plain text for stored history; the provider handles tool-call block plumbing
  // internally during the loop.
  content: string;
}

export interface RunToolLoopInput {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  // Executes a tool the model asked for and returns JSON-serialisable data.
  onToolCall: (name: string, input: any) => Promise<any>;
  model: string;
  maxTokens?: number;
  // Hard cap on tool round-trips (bounds cost + latency).
  maxTurns?: number;
}

export interface RunToolLoopResult {
  text: string;
  toolsUsed: string[];
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}

export interface RunToolLoopStreamInput extends RunToolLoopInput {
  // Called with each text token as the final answer streams in.
  onDelta: (text: string) => void;
}

export interface LlmProvider {
  runToolLoop(input: RunToolLoopInput): Promise<RunToolLoopResult>;
  // Streaming variant: same tool loop, but text tokens are pushed via onDelta as
  // they arrive. Resolves with the full final text once complete.
  runToolLoopStream(input: RunToolLoopStreamInput): Promise<RunToolLoopResult>;
  // Single-shot completion (no tools) — used by the digest generator.
  complete(input: {
    system: string;
    messages: LlmMessage[];
    model: string;
    maxTokens?: number;
  }): Promise<RunToolLoopResult>;
}

// DI token for the provider binding.
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
