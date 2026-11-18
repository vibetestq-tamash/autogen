import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectInfo } from '@shared/types';

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id?: string; name: string; summary: string; ok?: boolean; args?: Record<string, unknown> }
  | { kind: 'error'; text: string };

const SUGGESTIONS = [
  'Explore the home page and write smoke tests for the main navigation',
  'Explore the login page and create tests for valid and invalid login',
  'Look at the existing tests and tell me what important coverage is missing',
  'Run all tests and fix any failures'
];

const TOOL_ICON: Record<string, string> = {
  browser_navigate: '🌐',
  browser_snapshot: '👁',
  browser_click: '🖱',
  browser_fill: '⌨',
  browser_select: '☰',
  browser_check: '☑',
  browser_hover: '🖱',
  browser_press: '⌨',
  browser_inspect: '🔍',
  browser_back: '↩',
  list_files: '📁',
  read_file: '📖',
  write_file: '💾',
  edit_file: '✏',
  delete_file: '🗑',
  run_tests: '🧪'
};

interface Props {
  project: ProjectInfo;
  aiReady: boolean;
  onOpenSettings: () => void;
  onOpenFile: (path: string) => void;
}

export function ChatPanel({ project, aiReady, onOpenSettings, onOpenFile }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.api.agent.transcript().then((t) =>
      setItems(
        t.map((x): Item =>
          x.kind === 'tool' ? { kind: 'tool', name: x.name!, summary: x.summary ?? '', ok: x.ok } : { kind: x.kind as 'user' | 'assistant', text: x.text ?? '' }
        )
      )
    );
  }, [project.path]);

  useEffect(
    () =>
      window.api.agent.onEvent((e) => {
        switch (e.type) {
          case 'status':
            setStatus(e.text);
            break;
          case 'assistant':
            setItems((it) => [...it, { kind: 'assistant', text: e.text }]);
            break;
          case 'tool_call':
            setStatus(`${e.name.replace(/_/g, ' ')}…`);
            setItems((it) => [...it, { kind: 'tool', id: e.id, name: e.name, summary: '…', args: e.args }]);
            break;
          case 'tool_result':
            setItems((it) => it.map((x) => (x.kind === 'tool' && x.id === e.id ? { ...x, summary: e.summary, ok: e.ok } : x)));
            break;
          case 'error':
            setItems((it) => [...it, { kind: 'error', text: e.text }]);
            break;
          case 'done':
            setBusy(false);
            setStatus(e.stopped ? 'Stopped' : '');
            break;
        }
      }),
    []
  );

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, status]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setItems((it) => [...it, { kind: 'user', text: t }]);
    setInput('');
    setBusy(true);
    setStatus('Thinking…');
    try {
      await window.api.agent.send(t);
    } catch (e) {
      setBusy(false);
      setItems((it) => [...it, { kind: 'error', text: (e as Error).message }]);
    }
  };

  return (
    <div className="chat">
      <div className="pane-head">
        <span>AGENT</span>
        <button
          className="small"
          disabled={busy}
          onClick={async () => {
            await window.api.agent.reset();
            setItems([]);
            setStatus('');
          }}
          title="Start a new conversation (the agent forgets the previous one)"
        >
          New chat
        </button>
      </div>

      <div className="chat-list" ref={listRef}>
        {items.length === 0 && (
          <div className="chat-empty">
            <p>
              Tell the agent what to test on <b>{project.baseUrl || 'your application'}</b>. It explores the app in a browser,
              then writes page objects and specs into this repository.
            </p>
            {!aiReady && (
              <div className="banner warn">
                No API key yet. <button className="link" onClick={onOpenSettings}>Open Settings</button>
              </div>
            )}
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => setInput(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {items.map((it, i) => {
          if (it.kind === 'user') return <div key={i} className="msg user">{it.text}</div>;
          if (it.kind === 'assistant') return <div key={i} className="msg assistant"><Markdown text={it.text} onOpenFile={onOpenFile} /></div>;
          if (it.kind === 'error') return <div key={i} className="msg error">⚠ {it.text}</div>;
          return <ToolRow key={i} item={it} onOpenFile={onOpenFile} />;
        })}
        {busy && <div className="status-line"><span className="spinner" /> {status}</div>}
        {!busy && status && <div className="status-line muted">{status}</div>}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="e.g. Explore the checkout flow and write tests for adding and removing cart items (Enter to send, Shift+Enter for a new line)"
          rows={3}
          aria-label="Message to the agent"
        />
        {busy ? (
          <button type="button" className="danger" onClick={() => window.api.agent.stop()}>■ Stop</button>
        ) : (
          <button type="submit" className="primary" disabled={!input.trim()}>Send</button>
        )}
      </form>
    </div>
  );
}

function ToolRow({ item, onOpenFile }: { item: Extract<Item, { kind: 'tool' }>; onOpenFile: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const path = typeof item.args?.path === 'string' && /write_file|edit_file|read_file/.test(item.name) ? (item.args.path as string) : null;
  const state = item.ok === undefined ? 'pending' : item.ok ? 'ok' : 'fail';
  return (
    <div className={`tool-row ${state}`}>
      <button className="tool-main" onClick={() => setOpen((o) => !o)} title="Show details">
        <span className="tool-icon">{TOOL_ICON[item.name] ?? '•'}</span>
        <span className="tool-summary">{item.summary === '…' ? item.name.replace(/_/g, ' ') + '…' : item.summary}</span>
      </button>
      {path && <button className="link small" onClick={() => onOpenFile(path)}>open</button>}
      {open && item.args && <pre className="tool-args">{JSON.stringify(item.args, null, 2)}</pre>}
    </div>
  );
}

/** Small, safe markdown subset: code fences, inline code, bold, headings, bullet lists. No HTML injection. */
function Markdown({ text, onOpenFile }: { text: string; onOpenFile: (p: string) => void }) {
  const parts = text.split(/```[\w-]*\n?([\s\S]*?)```/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="code">{part.replace(/\n$/, '')}</pre>
        ) : (
          <Fragment key={i}>
            {part
              .split('\n')
              .reduce<string[][]>((blocks, line) => {
                if (line.trim() === '') blocks.push([]);
                else blocks[blocks.length - 1].push(line);
                return blocks;
              }, [[]])
              .filter((b) => b.length)
              .map((block, j) => {
                if (block.every((l) => /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l))) {
                  return (
                    <ul key={j}>
                      {block.map((l, k) => (
                        <li key={k}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''), onOpenFile)}</li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p key={j}>
                    {block.map((l, k) => {
                      const h = /^#{1,6}\s+(.*)/.exec(l);
                      return (
                        <Fragment key={k}>
                          {k > 0 && <br />}
                          {h ? <b>{inline(h[1], onOpenFile)}</b> : inline(l, onOpenFile)}
                        </Fragment>
                      );
                    })}
                  </p>
                );
              })}
          </Fragment>
        )
      )}
    </>
  );
}

function inline(s: string, onOpenFile: (p: string) => void): ReactNode[] {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((t, i) => {
    if (t.startsWith('`') && t.endsWith('`') && t.length > 2) {
      const code = t.slice(1, -1);
      // Project file paths in backticks become clickable.
      if (/^[\w.-]+(\/[\w.-]+)*\.(ts|js|json|md)$/.test(code)) {
        return <button key={i} className="code-link" onClick={() => onOpenFile(code.replace(/^\.\//, ''))}>{code}</button>;
      }
      return <code key={i}>{code}</code>;
    }
    if (t.startsWith('**') && t.endsWith('**') && t.length > 4) return <b key={i}>{t.slice(2, -2)}</b>;
    return t;
  });
}
