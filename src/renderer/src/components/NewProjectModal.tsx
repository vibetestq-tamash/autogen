import { useEffect, useState } from 'react';
import type { ProjectInfo } from '@shared/types';
import { Modal } from './Modal';

const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'e2e-tests';

export function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProjectInfo) => void }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://');
  const [parentDir, setParentDir] = useState('');
  const [installDeps, setInstallDeps] = useState(true);
  const [gitInit, setGitInit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.projects.defaultParent().then(setParentDir);
  }, []);

  const validUrl = /^https?:\/\/[^\s/]+/.test(baseUrl);
  const canCreate = name.trim() && validUrl && parentDir && !busy;
  const sep = parentDir.includes('\\') ? '\\' : '/';

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await window.api.projects.create({ name: name.trim(), baseUrl: baseUrl.trim(), parentDir, installDeps, gitInit }));
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setBusy(false);
    }
  };

  return (
    <Modal title="New test project" onClose={onClose}>
      <label className="field">
        <span>Project name</span>
        <input aria-label="Project name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My Shop E2E" />
      </label>
      <label className="field">
        <span>Application URL (base URL)</span>
        <input aria-label="Application URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://staging.myshop.com" />
        {!validUrl && baseUrl.length > 8 && <small className="error-text">Enter a full URL starting with http:// or https://</small>}
      </label>
      <label className="field">
        <span>Location</span>
        <div className="row">
          <input aria-label="Location" value={parentDir} onChange={(e) => setParentDir(e.target.value)} />
          <button
            onClick={async () => {
              const d = await window.api.projects.pickFolder('Choose where to create the project');
              if (d) setParentDir(d);
            }}
          >
            Browse…
          </button>
        </div>
        {name && <small className="muted">Creates {parentDir}{sep}{slug(name)}</small>}
      </label>
      <label className="check">
        <input type="checkbox" checked={installDeps} onChange={(e) => setInstallDeps(e.target.checked)} />
        Install dependencies and the Chromium browser now (needs Node.js and internet once)
      </label>
      <label className="check">
        <input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} />
        Initialize a git repository
      </label>
      {error && <div className="banner error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!canCreate} onClick={create}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </Modal>
  );
}
