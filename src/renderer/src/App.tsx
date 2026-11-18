import { useCallback, useEffect, useState } from 'react';
import type { ProjectInfo, Settings } from '@shared/types';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import { SettingsModal } from './components/SettingsModal';
import { NewProjectModal } from './components/NewProjectModal';

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.settings.get().then(setSettings);
    window.api.projects.current().then(setProject);
  }, []);

  const openProject = useCallback(async (path?: string) => {
    setError(null);
    try {
      const target = path ?? (await window.api.projects.pickFolder('Open a test project folder'));
      if (target) setProject(await window.api.projects.open(target));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  if (!settings) return null;

  return (
    <>
      {project ? (
        <Workspace
          key={project.path}
          project={project}
          settings={settings}
          onOpenSettings={() => setShowSettings(true)}
          onClose={() => setProject(null)}
          onNewProject={() => setShowNew(true)}
          onOpenProject={() => openProject()}
        />
      ) : (
        <Welcome
          settings={settings}
          error={error}
          onNew={() => setShowNew(true)}
          onOpen={openProject}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}
      {showSettings && <SettingsModal settings={settings} onSaved={setSettings} onClose={() => setShowSettings(false)} />}
      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={(p) => {
            setShowNew(false);
            setProject(p);
          }}
        />
      )}
    </>
  );
}
