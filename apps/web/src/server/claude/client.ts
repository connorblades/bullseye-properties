import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { requireApiKey } from './config';

/**
 * Server-only Anthropic SDK wrapper.
 *
 * Built on the classic `messages.stream()` surface (SDK 0.30.1): subscribe to
 * `text` deltas for live streaming, then await `finalMessage()` for the full
 * text plus token usage. Retry and Haiku fallback land in M3-T3; this module
 * is the single low-level entry point those will wrap.
 */

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: requireApiKey() });
  }
  return _client;
}

export type StreamMessageParams = {
  model: string;
  system: string;
  userPrompt: string;
  maxTokens?: number;
  /** Called for each streamed text delta. */
  onTextDelta?: (delta: string) => void;
};

export type StreamMessageResult = {
  text: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

/**
 * Stream a single-turn completion. Resolves once generation is complete with
 * the assembled text and usage. Throws Anthropic SDK errors (status codes,
 * overloaded, rate limit) untouched so callers can implement retry/fallback.
 */
export async function streamMessage(params: StreamMessageParams): Promise<StreamMessageResult> {
  const client = getClient();

  const stream = client.messages.stream({
    model: params.model,
    max_tokens: params.maxTokens ?? 4000,
    system: params.system,
    messages: [{ role: 'user', content: params.userPrompt }],
  });

  if (params.onTextDelta) {
    stream.on('text', (delta: string) => params.onTextDelta!(delta));
  }

  const final = await stream.finalMessage();

  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    text,
    modelUsed: final.model,
    inputTokens: final.usage.input_tokens,
    outputTokens: final.usage.output_tokens,
    stopReason: final.stop_reason,
  };
}
