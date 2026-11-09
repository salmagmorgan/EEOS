/* AI Copilot — answers questions grounded in the live workspace.
   The model gets a fresh data snapshot (built by the shared engine) as a cached system prompt,
   plus the recent conversation. Text streams back to the browser as it is generated. */
import Anthropic from '@anthropic-ai/sdk';
import { Router } from 'express';
import { z } from 'zod';
import { buildModel } from '../../shared/engine';
import { requireRole } from '../auth';
import type { DB } from '../db';
import { readWorkspace } from '../store';
import { parse, route } from './util';

const INSTRUCTIONS = `You are the AI Copilot inside The Board Consulting's Engagement Excellence Operating System (EEOS).
You brief partners and managers on staffing, utilization, engagement health, hiring gaps and team rotation.

Ground every statement in the live data snapshot below. Never invent people, engagements, clients or numbers that are not in it; if the snapshot doesn't contain what is needed, say what is missing.
Write like a sharp chief of staff: lead with the answer, then the few facts that support it, then concrete next steps naming specific people or engagements. Use short paragraphs or bullets. Skip generic disclaimers.
Definitions: utilization = sum of a person's allocation % across active engagements (Quick Work 25%, Business as Usual 35%, Heavy & Complex 50% members / 65% lead, supervisors 15%); Optimal is 75–90%, At Capacity 91–100%, Overutilized above 100%. Operations staff are excluded from automatic staffing suggestions.`;

export function copilotRoutes(db: DB, opts: { apiKey?: string; model: string }): Router {
  const r = Router();
  const client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : null;

  r.get('/copilot/status', requireRole('viewer'), route(() => ({ enabled: !!client, model: opts.model })));

  r.post('/copilot', requireRole('viewer'), route(async (req, res) => {
    const body = parse(z.object({
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8000) })).min(1).max(30),
    }), req.body);
    if (!client) {
      res.status(503).json({ error: 'The AI Copilot is not configured. An admin needs to set ANTHROPIC_API_KEY on the server.' });
      return;
    }
    // Keep the last turns only, starting on a user turn.
    let messages = body.messages.slice(-12);
    while (messages.length && messages[0].role !== 'user') messages = messages.slice(1);

    const model = buildModel(readWorkspace(db));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const stream = client.beta.messages.stream({
        model: opts.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: [
          { type: 'text', text: INSTRUCTIONS },
          { type: 'text', text: model.copilotContext(), cache_control: { type: 'ephemeral' } },
        ],
        messages,
      }, { signal: controller.signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') res.write(event.delta.text);
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') res.write('\n\n⚠ The model declined to answer this one. Try rephrasing the question.');
      else if (final.stop_reason === 'max_tokens') res.write('\n\n…(answer truncated)');
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Anthropic.RateLimitError ? 'The Copilot is busy right now — try again in a moment.'
        : err instanceof Anthropic.AuthenticationError ? 'The server’s Anthropic API key was rejected. An admin needs to update it.'
        : err instanceof Anthropic.APIError ? `The AI service returned an error (${err.status ?? 'network'}). Try again shortly.`
        : 'Could not reach the AI service. Try again shortly.';
      console.error('copilot error', err);
      res.write('\n\n⚠ ' + msg);
    }
    res.end();
  }));

  return r;
}
