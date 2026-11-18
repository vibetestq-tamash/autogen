import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PROVIDER_DEFAULTS, type ProjectInfo, type Settings, type SettingsUpdate } from '@shared/types';

interface StoredState {
  settings: Omit<Settings, 'hasApiKey'>;
  /** API keys per provider. Encrypted with the OS keychain when available. */
  keys: Partial<Record<string, { enc: boolean; value: string }>>;
  recentProjects: ProjectInfo[];
}

const DEFAULT_SETTINGS: Omit<Settings, 'hasApiKey'> = {
  provider: 'ollama-cloud',
  baseUrl: PROVIDER_DEFAULTS['ollama-cloud'].baseUrl,
  model: PROVIDER_DEFAULTS['ollama-cloud'].model,
  headed: true,
  browserChannel: '',
  autoRunTests: true,
  maxSteps: 40,
  temperature: 0.2
};

function storePath(): string {
  return join(app.getPath('userData'), 'autogen-state.json');
}

let cache: StoredState | null = null;

function load(): StoredState {
  if (cache) return cache;
  const fresh: StoredState = { settings: { ...DEFAULT_SETTINGS }, keys: {}, recentProjects: [] };
  try {
    if (existsSync(storePath())) {
      const parsed = JSON.parse(readFileSync(storePath(), 'utf8')) as Partial<StoredState>;
      cache = {
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        keys: parsed.keys ?? {},
        recentProjects: parsed.recentProjects ?? []
      };
      return cache;
    }
  } catch {
    /* corrupt file: start fresh */
  }
  cache = fresh;
  return cache;
}

function save(): void {
  const p = storePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(load(), null, 2), { mode: 0o600 });
}

export function getSettings(): Settings {
  const s = load();
  return { ...s.settings, hasApiKey: !!s.keys[s.settings.provider]?.value };
}

export function updateSettings(update: SettingsUpdate): Settings {
  const s = load();
  const { apiKey, ...rest } = update;
  s.settings = { ...s.settings, ...rest };
  if (apiKey !== undefined) {
    if (apiKey === '') delete s.keys[s.settings.provider];
    else if (safeStorage.isEncryptionAvailable()) {
      s.keys[s.settings.provider] = { enc: true, value: safeStorage.encryptString(apiKey).toString('base64') };
    } else {
      s.keys[s.settings.provider] = { enc: false, value: apiKey };
    }
  }
  save();
  return getSettings();
}

/** Only ever called inside the main process. */
export function getApiKey(provider = load().settings.provider): string | undefined {
  const entry = load().keys[provider];
  if (!entry?.value) return process.env.AUTOGEN_API_KEY || undefined;
  if (!entry.enc) return entry.value;
  try {
    return safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
  } catch {
    return undefined;
  }
}

export function getRecentProjects(): ProjectInfo[] {
  return load().recentProjects.filter((p) => existsSync(p.path));
}

export function addRecentProject(p: ProjectInfo): void {
  const s = load();
  s.recentProjects = [{ ...p, lastOpened: Date.now() }, ...s.recentProjects.filter((r) => r.path !== p.path)].slice(0, 15);
  save();
}

export function removeRecentProject(path: string): void {
  const s = load();
  s.recentProjects = s.recentProjects.filter((r) => r.path !== path);
  save();
}
