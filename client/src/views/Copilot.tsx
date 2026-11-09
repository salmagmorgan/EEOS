import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Card, Empty, PageHead } from '../components/ui';
import { api, streamText } from '../lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };
const QUICK = [
  ['📋', 'Executive brief', 'Give me a concise executive brief: engagement portfolio, utilization, and the top risks.'],
  ['⚠', 'Risks', 'Summarize the biggest risks and alerts right now, and what I should act on first.'],
  ['➕', 'Hiring gaps', 'Explain our current hiring gaps and why they exist, in plain language for a leadership meeting.'],
  ['🔥', 'Burnout review', 'Which talents are overutilized or flagged, and what should I do about each one?'],
  ['🔁', 'Rotation review', 'Which pairs keep getting staffed together, and which leaders carry too many concurrent engagements? Suggest who to rotate in instead.'],
];

export default function Copilot() {
  const status = useQuery({ queryKey: ['copilot-status'], queryFn: () => api.get<{ enabled: boolean; model: string }>('/copilot/status') });
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem('eeos-copilot') ?? '[]'); } catch { return []; } });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController>();
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); try { sessionStorage.setItem('eeos-copilot', JSON.stringify(msgs)); } catch { /* storage unavailable */ } }, [msgs]);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content: q.trim() }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    abort.current = new AbortController();
    let text = '';
    try {
      await streamText('/copilot', { messages: history }, (chunk) => {
        text += chunk;
        setMsgs([...history, { role: 'assistant', content: text }]);
      }, abort.current.signal);
    } catch (e) {
      if (!abort.current.signal.aborted) setMsgs([...history, { role: 'assistant', content: '⚠ ' + (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="AI Copilot" desc="Grounded in your live EEOS data — every answer is built from the current roster, engagements, utilization and history.">
        {msgs.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setMsgs([])}>Clear conversation</button>}
      </PageHead>
      {status.data && !status.data.enabled && <div className="viewer-banner">The Copilot isn't configured on this server yet. An admin needs to set <code>ANTHROPIC_API_KEY</code> and restart EEOS.</div>}
      <div className="qa-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', marginBottom: 16 }}>
        {QUICK.map(([ic, label, prompt]) => <button key={label} className="qa-btn" disabled={busy} onClick={() => ask(prompt)}><div className="qic">{ic}</div>{label}</button>)}
      </div>
      <Card style={{ display: 'flex', flexDirection: 'column', minHeight: 440 }}>
        <div ref={box} style={{ flex: 1, overflowY: 'auto', maxHeight: 520 }} aria-live="polite">
          {msgs.length ? msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
              <div className={'chat-bubble ' + (m.role === 'user' ? 'chat-user' : 'chat-ai')}>{m.content || (busy ? '⏳ Thinking…' : '')}</div>
            </div>
          )) : <Empty>Ask a question, or start with a quick action above.</Empty>}
        </div>
        <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <input className="inline-input" style={{ flex: 1, padding: '10px 14px', fontSize: 13 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about utilization, engagements, hiring gaps…" />
          {busy ? <button type="button" className="btn btn-sm" onClick={() => abort.current?.abort()}>Stop</button> : <button className="btn btn-primary btn-sm" disabled={!input.trim()}>Ask</button>}
        </form>
      </Card>
    </>
  );
}
