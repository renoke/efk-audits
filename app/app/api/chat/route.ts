import { NextRequest, NextResponse } from 'next/server';
import { retrieve, formatContext, extractReferences, type Reference } from '@/lib/retrieval';
import { detectLanguage, LANG_NAME } from '@/lib/language';
import {
  getConfig,
  INFOMANIAK_LLM_BASE,
  LLM_MODEL,
  LLM_TEMPERATURE,
  LLM_TOP_P,
  LLM_FREQUENCY_PENALTY,
} from '@/lib/config';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const BASE_SYSTEM_PROMPT = getConfig(
  'SYSTEM_PROMPT',
  'You are an expert analyst of Swiss EFK audit reports. Answer only from the provided context and cite audits as **EFK <number>: <title>**.',
);

function buildSystemPrompt(context: string, references: Reference[], languageName: string): string {
  const refList =
    references.length > 0
      ? `\n\nAudits available to cite (cite inline as **<reference>: <title>**, using these exact references):\n${references
          .map((r) => `- ${r.number ?? '?'}: ${r.title ?? ''}${r.year ? ` (${r.year})` : ''}`)
          .join('\n')}`
      : '';
  return [
    BASE_SYSTEM_PROMPT,
    `\nRespond entirely in ${languageName} (the user's language), regardless of the language of the context.`,
    `\nContext excerpts from the audit reports:\n\n${context}`,
    refList,
  ].join('');
}

async function* streamLLM(systemPrompt: string, history: ChatMessage[]): AsyncGenerator<string> {
  const token = process.env.INFOMANIAK_TOKEN;
  if (!token) throw new Error('Missing INFOMANIAK_TOKEN');

  const response = await fetch(`${INFOMANIAK_LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...history.slice(-6)],
      temperature: LLM_TEMPERATURE,
      top_p: LLM_TOP_P,
      frequency_penalty: LLM_FREQUENCY_PENALTY,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`LLM failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content as string;
      } catch {
        /* ignore keep-alive / partial */
      }
    }
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { messages } = (await request.json()) as { messages: ChatMessage[] };
    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') {
      return NextResponse.json({ error: 'Last message must be from user' }, { status: 400 });
    }

    const query = last.content;
    const lang = detectLanguage(query);
    const chunks = await retrieve(query, lang);
    const references = extractReferences(chunks);
    const systemPrompt = buildSystemPrompt(formatContext(chunks), references, LANG_NAME[lang]);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          send({ references });
          for await (const content of streamLLM(systemPrompt, messages)) {
            send({ content });
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          send({ error: err instanceof Error ? err.message : 'stream error' });
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
