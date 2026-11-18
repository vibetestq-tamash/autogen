import { useEffect } from 'react';
import Editor from '@monaco-editor/react';

export interface Tab {
  path: string;
  content: string;
  saved: string;
  dirty: boolean;
}

interface Props {
  tabs: Tab[];
  active: string | null;
  onSelect: (p: string) => void;
  onClose: (p: string) => void;
  onChange: (p: string, content: string) => void;
  onSave: (p: string) => void;
  onRunFile: (p: string) => void;
}

function language(path: string): string {
  if (/\.(ts|tsx)$/.test(path)) return 'typescript';
  if (/\.(js|mjs|cjs)$/.test(path)) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  if (/\.ya?ml$/.test(path)) return 'yaml';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.css')) return 'css';
  return 'plaintext';
}

export function EditorPane({ tabs, active, onSelect, onClose, onChange, onSave, onRunFile }: Props) {
  const tab = tabs.find((t) => t.path === active);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && active) {
        e.preventDefault();
        onSave(active);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onSave]);

  return (
    <div className="editor-pane">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <div key={t.path} role="tab" aria-selected={t.path === active} className={`tab ${t.path === active ? 'active' : ''}`} title={t.path}>
            <button className="tab-label" onClick={() => onSelect(t.path)}>
              {t.path.split('/').pop()}
              {t.dirty && <span className="dot">●</span>}
            </button>
            <button className="icon tab-close" onClick={() => onClose(t.path)} aria-label={`Close ${t.path}`}>×</button>
          </div>
        ))}
      </div>
      {tab ? (
        <>
          <div className="editor-bar">
            <span className="muted path">{tab.path}</span>
            <span className="grow" />
            {/\.(spec|test)\.ts$/.test(tab.path) && <button onClick={() => onRunFile(tab.path)}>▶ Run this file</button>}
            <button disabled={!tab.dirty} onClick={() => onSave(tab.path)}>Save</button>
          </div>
          <div className="editor-host">
            <Editor
              path={tab.path}
              language={language(tab.path)}
              value={tab.content}
              theme="vs-dark"
              onChange={(v) => onChange(tab.path, v ?? '')}
              options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2 }}
            />
          </div>
        </>
      ) : (
        <div className="editor-empty muted">Open a file from the explorer. Files the agent writes open here automatically.</div>
      )}
    </div>
  );
}
