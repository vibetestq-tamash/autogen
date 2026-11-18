// Types shared by the main process, preload bridge and renderer.

export type ProviderId = 'ollama-cloud' | 'ollama-local' | 'anthropic' | 'openai-compatible';

export interface Settings {
  provider: ProviderId;
  /** Base URL of the AI API. Defaults depend on the provider. */
  baseUrl: string;
  model: string;
  /** True when an API key is stored (the key itself never leaves the main process). */
  hasApiKey: boolean;
  /** Show the browser window while the agent explores. */
  headed: boolean;
  /** '' = Playwright's bundled Chromium; 'chrome' / 'msedge' = an installed browser (works without a download). */
  browserChannel: '' | 'chrome' | 'msedge';
  /** Let the agent run the tests it wrote and fix failures. */
  autoRunTests: boolean;
  /** Max agent steps (tool calls) per request. */
  maxSteps: number;
  temperature: number;
}

export interface SettingsUpdate extends Partial<Omit<Settings, 'hasApiKey'>> {
  /** undefined = keep the stored key, '' = remove it, otherwise replace it. */
  apiKey?: string;
}

export const PROVIDER_DEFAULTS: Record<ProviderId, { label: string; baseUrl: string; model: string; needsKey: boolean }> = {
  'ollama-cloud': { label: 'Ollama Cloud', baseUrl: 'https://ollama.com', model: 'gpt-oss:120b', needsKey: true },
  'ollama-local': { label: 'Ollama (local, offline)', baseUrl: 'http://localhost:11434', model: 'qwen3:8b', needsKey: false },
  anthropic: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', needsKey: true },
  'openai-compatible': { label: 'OpenAI-compatible API', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true }
};

export interface ProjectInfo {
  name: string;
  path: string;
  baseUrl?: string;
  lastOpened?: number;
}

export interface NewProjectOptions {
  name: string;
  parentDir: string;
  baseUrl: string;
  installDeps: boolean;
  gitInit: boolean;
}

export interface FileNode {
  name: string;
  path: string; // relative to project root, forward slashes
  type: 'file' | 'dir';
  children?: FileNode[];
}

/** Events streamed from the agent to the UI. */
export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'file_written'; path: string }
  | { type: 'error'; text: string }
  | { type: 'done'; stopped?: boolean };

/** Output streamed from a command run in the project (npm install, playwright test, ...). */
export type TerminalEvent =
  | { type: 'start'; id: string; command: string }
  | { type: 'data'; id: string; text: string }
  | { type: 'exit'; id: string; code: number | null };
