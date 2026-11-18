import { useEffect, useState } from 'react';
import { PROVIDER_DEFAULTS, type ProjectInfo, type Settings } from '@shared/types';

interface Props {
  settings: Settings;
  error: string | null;
  onNew: () => void;
  onOpen: (path?: string) => void;
  onOpenSettings: () => void;
}

export function Welcome({ settings, error, onNew, onOpen, onOpenSettings }: Props) {
  const [recent, setRecent] = useState<ProjectInfo[]>([]);
  useEffect(() => {
    window.api.projects.recent().then(setRecent);
  }, []);

  const provider = PROVIDER_DEFAULTS[settings.provider];
  const aiReady = !provider.needsKey || settings.hasApiKey;

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>AutoGen Test Studio</h1>
        <p className="muted">
          Each project is its own Playwright test repository. Describe what to test, and the agent explores your app in a
          real browser and writes the tests into the repo.
        </p>

        <div className="welcome-actions">
          <button className="primary big" onClick={onNew}>+ New test project</button>
          <button className="big" onClick={() => onOpen()}>Open project folder…</button>
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className={`ai-status ${aiReady ? 'ok' : 'warn'}`}>
          <span>
            AI: <b>{provider.label}</b> · {settings.model}
            {!aiReady && ' · no API key yet'}
          </span>
          <button className="link" onClick={onOpenSettings}>{aiReady ? 'Settings' : 'Add API key'}</button>
        </div>

        {recent.length > 0 && (
          <>
            <h3>Recent projects</h3>
            <ul className="recent">
              {recent.map((p) => (
                <li key={p.path}>
                  <button className="recent-item" onClick={() => onOpen(p.path)} title={p.path}>
                    <span className="recent-name">{p.name}</span>
                    <span className="recent-path">{p.path}</span>
                  </button>
                  <button
                    className="icon"
                    title="Remove from list"
                    onClick={async () => {
                      await window.api.projects.removeRecent(p.path);
                      setRecent((r) => r.filter((x) => x.path !== p.path));
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
