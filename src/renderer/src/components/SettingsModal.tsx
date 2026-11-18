import { useState } from 'react';
import { PROVIDER_DEFAULTS, type ProviderId, type Settings, type SettingsUpdate } from '@shared/types';
import { Modal } from './Modal';

const KEY_HELP: Record<ProviderId, string> = {
  'ollama-cloud': 'Create a key at ollama.com → Settings → API keys.',
  'ollama-local': 'No key needed. Runs fully offline with a local Ollama server (ollama serve) and a model that supports tools.',
  anthropic:
    'Use an Anthropic API key from console.anthropic.com (starts with sk-ant-api). Claude.ai subscription tokens (sk-ant-oat) only work in Anthropic’s own apps.',
  'openai-compatible': 'Any server with an OpenAI-style /chat/completions endpoint.'
};

const clean = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function SettingsModal({ settings, onSaved, onClose }: { settings: Settings; onSaved: (s: Settings) => void; onClose: () => void }) {
  const [form, setForm] = useState(settings);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const def = PROVIDER_DEFAULTS[form.provider];

  const changeProvider = async (p: ProviderId) => {
    // Keys are stored per provider; refresh the "key saved" state for the new one.
    const s = await window.api.settings.update({ provider: p, baseUrl: PROVIDER_DEFAULTS[p].baseUrl, model: PROVIDER_DEFAULTS[p].model });
    setForm(s);
    onSaved(s);
    setModels([]);
    setApiKey('');
    setMsg(null);
  };

  const save = async (): Promise<Settings> => {
    const { hasApiKey: _ignored, ...rest } = form;
    const update: SettingsUpdate = { ...rest };
    if (apiKey.trim()) update.apiKey = apiKey.trim();
    const s = await window.api.settings.update(update);
    setForm(s);
    setApiKey('');
    onSaved(s);
    return s;
  };

  const fetchModels = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await save();
      const list = await window.api.settings.listModels();
      setModels(list);
      setMsg({ kind: 'ok', text: `Connected. ${list.length} model${list.length === 1 ? "" : "s"} available.` });
    } catch (e) {
      setMsg({ kind: 'error', text: clean((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <h3 className="section">AI provider</h3>
      <label className="field">
        <span>Provider</span>
        <select aria-label="Provider" value={form.provider} onChange={(e) => changeProvider(e.target.value as ProviderId)}>
          {(Object.keys(PROVIDER_DEFAULTS) as ProviderId[]).map((p) => (
            <option key={p} value={p}>{PROVIDER_DEFAULTS[p].label}</option>
          ))}
        </select>
        <small className="muted">{KEY_HELP[form.provider]}</small>
      </label>

      {def.needsKey && (
        <label className="field">
          <span>API key {form.hasApiKey && <em className="saved">saved (encrypted)</em>}</span>
          <div className="row">
            <input
              type="password"
              aria-label="API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={form.hasApiKey ? '•••••••• (leave empty to keep)' : 'Paste your API key'}
              autoComplete="off"
            />
            {form.hasApiKey && (
              <button
                onClick={async () => {
                  const s = await window.api.settings.update({ apiKey: '' });
                  setForm(s);
                  onSaved(s);
                }}
              >
                Remove
              </button>
            )}
          </div>
          {form.provider === 'anthropic' && apiKey.startsWith('sk-ant-oat') && (
            <small className="error-text">This is a Claude.ai subscription token. It will not work here; use an API key (sk-ant-api…).</small>
          )}
        </label>
      )}

      <label className="field">
        <span>Base URL</span>
        <input aria-label="Base URL" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder={def.baseUrl} />
      </label>

      <label className="field">
        <span>Model</span>
        <div className="row">
          <input aria-label="Model" list="model-list" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder={def.model} />
          <datalist id="model-list">
            {models.map((m) => <option key={m} value={m} />)}
          </datalist>
          <button disabled={busy} onClick={fetchModels}>{busy ? 'Checking…' : 'Test & list models'}</button>
        </div>
        <small className="muted">The model must support tool calling.</small>
      </label>
      {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}

      <h3 className="section">Agent</h3>
      <label className="check">
        <input type="checkbox" checked={form.headed} onChange={(e) => set('headed', e.target.checked)} />
        Show the browser while the agent explores
      </label>
      <label className="check">
        <input type="checkbox" checked={form.autoRunTests} onChange={(e) => set('autoRunTests', e.target.checked)} />
        Let the agent run the tests it writes and fix failures
      </label>
      <div className="grid2">
        <label className="field">
          <span>Exploration browser</span>
          <select aria-label="Exploration browser" value={form.browserChannel} onChange={(e) => set('browserChannel', e.target.value as Settings['browserChannel'])}>
            <option value="">Playwright Chromium (bundled)</option>
            <option value="chrome">Installed Google Chrome</option>
            <option value="msedge">Installed Microsoft Edge</option>
          </select>
        </label>
        <label className="field">
          <span>Max steps per request</span>
          <input aria-label="Max steps per request" type="number" min={5} max={200} value={form.maxSteps} onChange={(e) => set('maxSteps', Number(e.target.value) || 40)} />
        </label>
      </div>
      <label className="field">
        <span>Temperature ({form.temperature.toFixed(1)}) {form.provider === 'anthropic' && <em className="muted">not used for Claude</em>}</span>
        <input aria-label="Temperature" type="range" min={0} max={1} step={0.1} value={form.temperature} onChange={(e) => set('temperature', Number(e.target.value))} />
      </label>

      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          onClick={async () => {
            try {
              await save();
              onClose();
            } catch (e) {
              setMsg({ kind: 'error', text: clean((e as Error).message) });
            }
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
