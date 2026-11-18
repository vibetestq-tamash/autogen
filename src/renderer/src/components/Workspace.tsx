import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDER_DEFAULTS, type FileNode, type ProjectInfo, type Settings, type TerminalEvent } from '@shared/types';
import { FileTree } from './FileTree';
import { ChatPanel } from './ChatPanel';
import { EditorPane, type Tab } from './EditorPane';
import { TerminalPanel } from './TerminalPanel';
import { Splitter } from './Splitter';

interface Props {
  project: ProjectInfo;
  settings: Settings;
  onOpenSettings: () => void;
  onClose: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
}

const MAX_TERMINAL = 200_000;
const clean = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function Workspace({ project, settings, onOpenSettings, onClose, onNewProject, onOpenProject }: Props) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Record<string, number>>({});
  const [terminal, setTerminal] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sizes, setSizes] = useState({ left: 260, right: 560, bottom: 220 });
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const refreshTree = useCallback(() => window.api.fs.tree().then(setTree), []);

  const openFile = useCallback(async (path: string, focus = true) => {
    try {
      const content = await window.api.fs.read(path);
      setTabs((ts) => {
        const existing = ts.find((t) => t.path === path);
        if (existing) return existing.dirty ? ts : ts.map((t) => (t.path === path ? { ...t, content, saved: content } : t));
        return [...ts, { path, content, saved: content, dirty: false }];
      });
      if (focus) setActive(path);
    } catch (e) {
      setToast(clean((e as Error).message));
    }
  }, []);

  // Keep tree and clean tabs in sync with the disk (the agent and other tools write files too).
  useEffect(() => {
    refreshTree();
    return window.api.fs.onChanged(async () => {
      refreshTree();
      for (const t of tabsRef.current) {
        if (t.dirty) continue;
        try {
          const content = await window.api.fs.read(t.path);
          if (content !== t.saved) setTabs((ts) => ts.map((x) => (x.path === t.path && !x.dirty ? { ...x, content, saved: content } : x)));
        } catch {
          setTabs((ts) => ts.filter((x) => x.path !== t.path)); // file was deleted
        }
      }
    });
  }, [refreshTree]);

  // Show files the agent writes as it writes them.
  useEffect(
    () =>
      window.api.agent.onEvent((e) => {
        if (e.type === 'file_written') {
          setHighlight((h) => ({ ...h, [e.path]: Date.now() }));
          refreshTree();
          openFile(e.path);
        }
      }),
    [openFile, refreshTree]
  );

  useEffect(() => {
    const t = setInterval(() => {
      setHighlight((h) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(h).filter(([, at]) => now - at < 15000));
        return Object.keys(next).length === Object.keys(h).length ? h : next;
      });
    }, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(
    () =>
      window.api.run.onEvent((e: TerminalEvent) => {
        if (e.type === 'start') {
          setRunningId(e.id);
          setTerminal((t) => (t + `\n$ ${e.command}\n`).slice(-MAX_TERMINAL));
        } else if (e.type === 'data') {
          setTerminal((t) => (t + e.text).slice(-MAX_TERMINAL));
        } else {
          setRunningId((r) => (r === e.id ? null : r));
          setTerminal((t) => (t + `\n[exit ${e.code ?? 'killed'}]\n`).slice(-MAX_TERMINAL));
        }
      }),
    []
  );

  const run = async (cmd: string) => {
    try {
      await window.api.run.command(cmd);
    } catch (e) {
      setToast(clean((e as Error).message));
    }
  };

  const saveTab = async (path: string) => {
    const tab = tabsRef.current.find((t) => t.path === path);
    if (!tab) return;
    await window.api.fs.write(path, tab.content);
    setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, saved: t.content, dirty: false } : t)));
  };

  const closeTab = (path: string) => {
    const tab = tabsRef.current.find((t) => t.path === path);
    if (tab?.dirty && !confirm(`${path} has unsaved changes. Close anyway?`)) return;
    setTabs((ts) => {
      const next = ts.filter((t) => t.path !== path);
      if (active === path) setActive(next.length ? next[next.length - 1].path : null);
      return next;
    });
  };

  const provider = PROVIDER_DEFAULTS[settings.provider];
  const aiReady = !provider.needsKey || settings.hasApiKey;

  return (
    <div className="workspace" style={{ gridTemplateColumns: `${sizes.left}px 4px 1fr 4px ${sizes.right}px` }}>
      <header className="toolbar">
        <div className="toolbar-left">
          <span className="project-name" title={project.path}>{project.name}</span>
          {project.baseUrl && <span className="base-url">{project.baseUrl}</span>}
        </div>
        <div className="toolbar-actions">
          <button className="primary" disabled={!!runningId} onClick={() => run('npx playwright test')} title="Run every test headless">▶ Run tests</button>
          <button disabled={!!runningId} onClick={() => run('npx playwright test --headed')}>Run headed</button>
          <button onClick={() => window.api.run.openReport().catch((e) => setToast(clean(e.message)))}>Report</button>
          <span className="sep" />
          <button disabled={!!runningId} onClick={() => run('npm install')} title="Install the project's npm dependencies">Install deps</button>
          <button disabled={!!runningId} onClick={() => run('npx playwright install chromium')} title="Download the Chromium build Playwright uses">Install browsers</button>
          <span className="sep" />
          <button onClick={() => window.api.projects.reveal()}>Open folder</button>
          <button className={aiReady ? '' : 'warn'} onClick={onOpenSettings} title={`${provider.label} · ${settings.model}`}>
            ⚙ {aiReady ? settings.model : 'Add API key'}
          </button>
          <ProjectMenu onNew={onNewProject} onOpen={onOpenProject} onClose={onClose} />
        </div>
      </header>

      <aside className="pane explorer">
        <div className="pane-head">
          <span>EXPLORER</span>
          <button className="icon" title="Refresh" onClick={refreshTree}>⟳</button>
        </div>
        <FileTree nodes={tree} activePath={active} highlight={highlight} onOpen={(p) => openFile(p)} />
      </aside>
      <Splitter onDrag={(dx) => setSizes((s) => ({ ...s, left: Math.min(500, Math.max(160, s.left + dx)) }))} />

      <main className="pane center">
        <div className="center-split" style={{ gridTemplateRows: `1fr 4px ${sizes.bottom}px` }}>
          <ChatPanel project={project} aiReady={aiReady} onOpenSettings={onOpenSettings} onOpenFile={openFile} />
          <Splitter vertical onDrag={(dy) => setSizes((s) => ({ ...s, bottom: Math.min(600, Math.max(80, s.bottom - dy)) }))} />
          <TerminalPanel
            output={terminal}
            runningId={runningId}
            onRun={run}
            onKill={() => runningId && window.api.run.kill(runningId)}
            onClear={() => setTerminal('')}
          />
        </div>
      </main>
      <Splitter onDrag={(dx) => setSizes((s) => ({ ...s, right: Math.min(1100, Math.max(280, s.right - dx)) }))} />

      <section className="pane editor">
        <EditorPane
          tabs={tabs}
          active={active}
          onSelect={setActive}
          onClose={closeTab}
          onChange={(path, content) =>
            setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, content, dirty: content !== t.saved } : t)))
          }
          onSave={saveTab}
          onRunFile={(path) => run(`npx playwright test "${path}"`)}
        />
      </section>

      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast} <span className="muted">(click to dismiss)</span>
        </div>
      )}
    </div>
  );
}

function ProjectMenu({ onNew, onOpen, onClose }: { onNew: () => void; onOpen: () => void; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu">Project ▾</button>
      {open && (
        <div className="menu" role="menu" onMouseLeave={() => setOpen(false)}>
          <button role="menuitem" onClick={() => { setOpen(false); onNew(); }}>New project…</button>
          <button role="menuitem" onClick={() => { setOpen(false); onOpen(); }}>Open project…</button>
          <button role="menuitem" onClick={() => { setOpen(false); onClose(); }}>Close project</button>
        </div>
      )}
    </div>
  );
}
