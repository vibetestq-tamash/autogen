import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { NewProjectOptions, ProjectInfo, SettingsUpdate, TerminalEvent } from '@shared/types';
import { addRecentProject, getRecentProjects, getSettings, removeRecentProject, updateSettings } from './settings';
import { deletePath, listTree, readText, safeResolve, watchProject, writeText } from './fsService';
import { scaffoldProject, slugify } from './scaffold';
import { killAll, killRun, runCommand } from './runner';
import { Agent, projectBaseUrl } from './agent/agent';
import { createProvider } from './llm';

let win: BrowserWindow | null = null;
let project: ProjectInfo | null = null;
let agent: Agent | null = null;
let watcher: FSWatcher | null = null;

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
const onTerminal = (e: TerminalEvent) => send('terminal:event', e);

function createWindow(): void {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    title: 'AutoGen Test Studio',
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.setMenuBarVisibility(false);
  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

function requireProject(): ProjectInfo {
  if (!project) throw new Error('No project is open');
  return project;
}

async function openProject(path: string): Promise<ProjectInfo> {
  if (!existsSync(path)) throw new Error(`Folder not found: ${path}`);
  await agent?.dispose();
  await watcher?.close();
  let name = basename(path);
  try {
    const meta = JSON.parse(readFileSync(join(path, '.autogen', 'project.json'), 'utf8'));
    if (meta.name) name = meta.name;
  } catch {
    /* not created by this app - still fine to open any Playwright repo */
  }
  project = { name, path, baseUrl: projectBaseUrl(path) };
  agent = new Agent(path, name);
  watcher = watchProject(path, () => send('fs:changed'));
  addRecentProject(project);
  win?.setTitle(`${name} - AutoGen Test Studio`);
  return project;
}

function registerIpc(): void {
  // Settings
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:update', (_e, u: SettingsUpdate) => updateSettings(u));
  ipcMain.handle('models:list', async () => createProvider(getSettings()).listModels());

  // Projects
  ipcMain.handle('projects:recent', () => getRecentProjects());
  ipcMain.handle('projects:removeRecent', (_e, path: string) => removeRecentProject(path));
  ipcMain.handle('projects:current', () => project);
  ipcMain.handle('projects:pickFolder', async (_e, title: string) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('projects:defaultParent', () => join(app.getPath('documents'), 'AutoGenProjects'));
  ipcMain.handle('projects:open', (_e, path: string) => openProject(path));
  ipcMain.handle('projects:create', async (_e, o: NewProjectOptions) => {
    const dir = join(o.parentDir, slugify(o.name));
    scaffoldProject(dir, o.name, o.baseUrl);
    const info = await openProject(dir);
    // Setup steps stream into the terminal panel; the UI is usable meanwhile.
    void (async () => {
      if (o.gitInit) {
        await runCommand(dir, 'git init && git add -A && git commit -q -m "Initial test project" || echo "(git commit skipped)"', onTerminal).done;
      }
      if (o.installDeps) {
        const r = await runCommand(dir, 'npm install', onTerminal, { timeoutMs: 15 * 60_000 }).done;
        if (r.code === 0) await runCommand(dir, 'npx playwright install chromium', onTerminal, { timeoutMs: 15 * 60_000 }).done;
      }
    })();
    return info;
  });
  ipcMain.handle('projects:reveal', () => shell.openPath(requireProject().path));

  // Files
  ipcMain.handle('fs:tree', () => (project ? listTree(project.path) : []));
  ipcMain.handle('fs:read', (_e, rel: string) => readText(requireProject().path, rel));
  ipcMain.handle('fs:write', (_e, rel: string, content: string) => writeText(requireProject().path, rel, content));
  ipcMain.handle('fs:delete', (_e, rel: string) => deletePath(requireProject().path, rel));
  ipcMain.handle('fs:reveal', (_e, rel: string) => shell.showItemInFolder(safeResolve(requireProject().path, rel)));

  // Agent
  ipcMain.handle('agent:send', (_e, text: string) => {
    if (!agent) throw new Error('Open a project first');
    void agent.run(text, getSettings(), (ev) => send('agent:event', ev), onTerminal);
  });
  ipcMain.handle('agent:stop', () => agent?.stop());
  ipcMain.handle('agent:reset', () => agent?.reset());
  ipcMain.handle('agent:transcript', () => agent?.transcript() ?? []);

  // Commands (terminal panel)
  ipcMain.handle('run:command', (_e, command: string) => {
    const { id } = runCommand(requireProject().path, command, onTerminal);
    return id;
  });
  ipcMain.handle('run:kill', (_e, id: string) => killRun(id));
  ipcMain.handle('run:openReport', async () => {
    const report = join(requireProject().path, 'playwright-report', 'index.html');
    if (!existsSync(report)) throw new Error('No report yet. Run the tests first.');
    const err = await shell.openPath(report);
    if (err) throw new Error(err);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killAll();
  void agent?.dispose();
  void watcher?.close();
});
