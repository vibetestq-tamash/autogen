import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { FileNode } from '@shared/types';

/** Folders hidden from the tree and from the agent's file listing. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'blob-report', '.cache']);

/**
 * Resolves `rel` inside `root` and refuses anything that escapes it
 * (../, absolute paths, symlink-style tricks in the string).
 */
export function safeResolve(root: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = resolve(root, cleaned);
  const rootResolved = resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) {
    throw new Error(`Path is outside the project: ${rel}`);
  }
  return full;
}

export function toRel(root: string, full: string): string {
  return relative(root, full).split(sep).join('/');
}

export async function listTree(root: string, rel = ''): Promise<FileNode[]> {
  const dir = safeResolve(root, rel);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: FileNode[] = [];
  for (const e of entries) {
    if (e.isDirectory() && IGNORED_DIRS.has(e.name)) continue;
    if (e.name === '.DS_Store') continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path: childRel, type: 'dir', children: await listTree(root, childRel) });
    } else if (e.isFile()) {
      nodes.push({ name: e.name, path: childRel, type: 'file' });
    }
  }
  return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

/** Flat list of file paths (for the agent). */
export async function listFilesFlat(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  const walk = (nodes: FileNode[]) => {
    for (const n of nodes) {
      if (n.type === 'file') out.push(n.path);
      else walk(n.children ?? []);
    }
  };
  walk(await listTree(root, rel));
  return out;
}

export async function readText(root: string, rel: string): Promise<string> {
  return fs.readFile(safeResolve(root, rel), 'utf8');
}

export async function writeText(root: string, rel: string, content: string): Promise<void> {
  const full = safeResolve(root, rel);
  await fs.mkdir(join(full, '..'), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

export async function deletePath(root: string, rel: string): Promise<void> {
  const full = safeResolve(root, rel);
  if (full === resolve(root)) throw new Error('Refusing to delete the project root');
  await fs.rm(full, { recursive: true, force: true });
}

export function readTextIfExists(root: string, rel: string): string | undefined {
  try {
    const p = safeResolve(root, rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

/** Watches the project and calls `onChange` (debounced) when files appear, change or disappear. */
export function watchProject(root: string, onChange: () => void): FSWatcher {
  let timer: NodeJS.Timeout | undefined;
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p: string) => p.split(/[\\/]/).some((part) => IGNORED_DIRS.has(part)),
    depth: 12
  });
  watcher.on('all', () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 200);
  });
  return watcher;
}
