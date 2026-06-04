'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './ChatInterface.module.css';

interface Reference {
  number: string | null;
  title: string | null;
  year: number | null;
  url: string | null;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  references?: Reference[];
}

const EXAMPLES = [
  'Quels risques le CDF a-t-il identifiés dans la gestion des risques de la Confédération ?',
  'Welche Mängel wurden bei der Beschaffung von Informatikleistungen festgestellt?',
  'What did the EFK find about subsidy oversight?',
  "Quali raccomandazioni sono state formulate sull'efficienza dei controlli interni?",
];

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: text };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput('');
    setIsLoading(true);

    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', references: [] }]);

    const update = (patch: Partial<Message>) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) throw new Error('Request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let references: Reference[] = [];

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]' || !payload) continue;
          try {
            const obj = JSON.parse(payload);
            if (obj.references) {
              references = obj.references;
              update({ references });
            }
            if (obj.content) {
              content += obj.content;
              update({ content });
            }
            if (obj.error) {
              content += `\n\n_⚠️ ${obj.error}_`;
              update({ content });
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      update({ content: `_⚠️ ${err instanceof Error ? err.message : 'Erreur'}_` });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={styles.chat}>
      <header className={styles.header}>
        <h1>EFK Audits — Recherche &amp; Chat</h1>
        <p>Posez une question en FR / DE / EN / IT sur les rapports d&apos;audit du Contrôle fédéral des finances.</p>
      </header>

      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.examples}>
            {EXAMPLES.map((ex) => (
              <button key={ex} className={styles.example} onClick={() => sendMessage(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`${styles.msg} ${m.role === 'user' ? styles.user : styles.assistant}`}>
            <div className={styles.role}>{m.role === 'user' ? 'Vous' : 'Assistant'}</div>
            <div className={styles.content}>
              {m.content ? <ReactMarkdown>{m.content}</ReactMarkdown> : <span className={styles.dots}>…</span>}
            </div>
            {m.references && m.references.length > 0 && (
              <div className={styles.sources}>
                <span className={styles.sourcesLabel}>Sources</span>
                <ul>
                  {m.references.map((r, i) => (
                    <li key={i}>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          <strong>EFK {r.number}</strong>: {r.title} {r.year ? `(${r.year})` : ''}
                        </a>
                      ) : (
                        <span>
                          <strong>EFK {r.number}</strong>: {r.title}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Votre question…" autoFocus />
        <button type="submit" disabled={isLoading || !input.trim()}>
          Envoyer
        </button>
      </form>
    </div>
  );
}
