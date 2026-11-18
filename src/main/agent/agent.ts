import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent, Settings, TerminalEvent } from '@shared/types';
import { createProvider } from '../llm';
import type { ChatMessage } from '../llm/types';
import { listFilesFlat, readTextIfExists } from '../fsService';
import { LAYOUT } from '../scaffold';
import { BrowserSession } from './browser';
import { buildSystemPrompt } from './prompt';
import { executeTool, TOOL_SPECS } from './tools';

/** One display item in the chat panel, rebuilt from history when a project is reopened. */
export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; summary: string; ok: boolean };

const HISTORY_FILE = `${LAYOUT.meta}/chat-history.json`;

export function projectBaseUrl(root: string): string | undefined {
  const env = readTextIfExists(root, '.env');
  const fromEnv = env?.match(/^\s*BASE_URL\s*=\s*(.+)\s*$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (fromEnv) return fromEnv;
  try {
    return JSON.parse(readTextIfExists(root, `${LAYOUT.meta}/project.json`) ?? '{}').baseUrl;
  } catch {
    return undefined;
  }
}

export class Agent {
  private history: ChatMessage[] = [];
  /** UI summaries of tool results, keyed by tool call id (for rebuilding the transcript). */
  private toolSummaries: Record<string, { summary: string; ok: boolean }> = {};
  private browser?: BrowserSession;
  private abort?: AbortController;

  constructor(
    readonly root: string,
    readonly projectName: string
  ) {
    this.loadHistory();
  }

  get busy(): boolean {
    return !!this.abort;
  }

  private loadHistory(): void {
    const p = join(this.root, HISTORY_FILE);
    if (!existsSync(p)) return;
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      this.history = Array.isArray(data.history) ? data.history : [];
      this.toolSummaries = data.toolSummaries ?? {};
    } catch {
      /* ignore a corrupt history */
    }
  }

  private saveHistory(): void {
    try {
      mkdirSync(join(this.root, LAYOUT.meta), { recursive: true });
      writeFileSync(join(this.root, HISTORY_FILE), JSON.stringify({ history: this.history, toolSummaries: this.toolSummaries }));
    } catch {
      /* non-fatal */
    }
  }

  transcript(): TranscriptItem[] {
    const items: TranscriptItem[] = [];
    for (const m of this.history) {
      if (m.role === 'user') items.push({ kind: 'user', text: m.content });
      else if (m.role === 'assistant') {
        if (m.content) items.push({ kind: 'assistant', text: m.content });
      } else {
        const s = this.toolSummaries[m.toolCallId];
        items.push({ kind: 'tool', name: m.name, summary: s?.summary ?? '', ok: s?.ok ?? !m.isError });
      }
    }
    return items;
  }

  async reset(): Promise<void> {
    this.stop();
    this.history = [];
    this.toolSummaries = {};
    rmSync(join(this.root, HISTORY_FILE), { force: true });
    await this.browser?.close();
    this.browser = undefined;
  }

  stop(): void {
    this.abort?.abort();
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.browser?.close();
  }

  /**
   * Shortens old, large tool results so long sessions stay inside small context windows.
   * Only used for providers that allow it (not Claude, whose history must stay append-only).
   */
  private trimmedHistory(): ChatMessage[] {
    const toolIdx = this.history.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
    const keepFull = new Set(toolIdx.slice(-6));
    return this.history.map((m, i) =>
      m.role === 'tool' && !keepFull.has(i) && m.content.length > 1500
        ? { ...m, content: m.content.slice(0, 600) + '\n... [older output shortened]' }
        : m
    );
  }

  async run(userText: string, settings: Settings, emit: (e: AgentEvent) => void, onTerminal: (e: TerminalEvent) => void): Promise<void> {
    if (this.abort) {
      emit({ type: 'error', text: 'The agent is already working. Stop it first.' });
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    try {
      const provider = createProvider(settings);
      const baseUrl = projectBaseUrl(this.root);
      if (!this.browser) {
        this.browser = new BrowserSession({ headed: settings.headed, channel: settings.browserChannel, baseUrl });
      }
      this.history.push({ role: 'user', content: userText });
      this.saveHistory();

      for (let step = 0; step < settings.maxSteps; step++) {
        if (abort.signal.aborted) break;
        emit({ type: 'status', text: step === 0 ? 'Thinking…' : `Working (step ${step + 1})…` });

        const system = buildSystemPrompt({
          projectName: this.projectName,
          baseUrl,
          conventions: readTextIfExists(this.root, 'AGENTS.md'),
          fileList: await listFilesFlat(this.root),
          autoRunTests: settings.autoRunTests
        });
        const res = await provider.chat({
          system,
          messages: provider.allowsHistoryTrim ? this.trimmedHistory() : this.history,
          tools: TOOL_SPECS,
          temperature: settings.temperature,
          signal: abort.signal
        });

        this.history.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls, raw: res.raw });
        if (res.content) emit({ type: 'assistant', text: res.content });

        if (res.toolCalls.length === 0) {
          this.saveHistory();
          emit({ type: 'done' });
          return;
        }

        for (const call of res.toolCalls) {
          if (abort.signal.aborted) {
            // Every tool call needs a result, or the next request is rejected.
            this.history.push({ role: 'tool', toolCallId: call.id, name: call.name, content: 'Stopped by the user.', isError: true });
            continue;
          }
          emit({ type: 'tool_call', id: call.id, name: call.name, args: redactArgs(call.args) });
          const outcome = await executeTool(call.name, call.args, {
            root: this.root,
            browser: this.browser,
            autoRunTests: settings.autoRunTests,
            signal: abort.signal,
            onTerminal,
            onFileWritten: (path) => emit({ type: 'file_written', path })
          });
          this.history.push({ role: 'tool', toolCallId: call.id, name: call.name, content: outcome.output, isError: !outcome.ok });
          this.toolSummaries[call.id] = { summary: outcome.summary, ok: outcome.ok };
          emit({ type: 'tool_result', id: call.id, name: call.name, ok: outcome.ok, summary: outcome.summary });
        }
        this.saveHistory();
      }

      if (abort.signal.aborted) {
        emit({ type: 'done', stopped: true });
      } else {
        emit({
          type: 'error',
          text: `Reached the step limit (${settings.maxSteps}). Say "continue" to let the agent keep going, or raise the limit in Settings.`
        });
        emit({ type: 'done' });
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError' || abort.signal.aborted) {
        emit({ type: 'done', stopped: true });
      } else {
        emit({ type: 'error', text: (e as Error).message });
        emit({ type: 'done' });
      }
    } finally {
      this.repairDanglingToolCalls();
      this.saveHistory();
      this.abort = undefined;
    }
  }

  /** If a run was interrupted mid-step, give every tool call a result so the history stays valid. */
  private repairDanglingToolCalls(): void {
    const answered = new Set(this.history.filter((m) => m.role === 'tool').map((m) => (m as { toolCallId: string }).toolCallId));
    const last = this.history[this.history.length - 1];
    if (last?.role === 'assistant') {
      for (const tc of last.toolCalls ?? []) {
        if (!answered.has(tc.id)) {
          this.history.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: 'Stopped by the user.', isError: true });
        }
      }
    }
  }
}

/** Keeps long file contents out of the UI log. */
function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}… (${v.length} chars)` : v;
  }
  return out;
}
