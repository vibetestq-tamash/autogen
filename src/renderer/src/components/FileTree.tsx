import { useState } from 'react';
import type { FileNode } from '@shared/types';

interface Props {
  nodes: FileNode[];
  activePath: string | null;
  highlight: Record<string, number>;
  onOpen: (path: string) => void;
}

const DEFAULT_OPEN = new Set(['tests', 'pages', 'fixtures', 'test-data']);

function fileIcon(name: string): string {
  if (name.endsWith('.spec.ts') || name.endsWith('.test.ts')) return '🧪';
  if (name.endsWith('.ts') || name.endsWith('.js')) return '📜';
  if (name.endsWith('.json')) return '🔧';
  if (name.endsWith('.md')) return '📝';
  if (name.startsWith('.env')) return '🔑';
  return '📄';
}

export function FileTree(props: Props) {
  const [open, setOpen] = useState<Set<string>>(DEFAULT_OPEN);
  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  if (!props.nodes.length) return <div className="tree-empty muted">Empty project</div>;
  return (
    <ul className="tree" role="tree">
      <Nodes {...props} depth={0} open={open} toggle={toggle} />
    </ul>
  );
}

function Nodes({
  nodes,
  depth,
  open,
  toggle,
  activePath,
  highlight,
  onOpen
}: Props & { depth: number; open: Set<string>; toggle: (p: string) => void }) {
  return (
    <>
      {nodes.map((n) => {
        const isOpen = open.has(n.path);
        // A folder lights up when the agent just wrote something inside it.
        const hot = n.type === 'file' ? highlight[n.path] !== undefined : Object.keys(highlight).some((p) => p.startsWith(n.path + '/'));
        return (
          <li key={n.path} role="treeitem" aria-expanded={n.type === 'dir' ? isOpen : undefined}>
            <button
              className={`tree-row ${activePath === n.path ? 'active' : ''} ${hot ? 'hot' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => (n.type === 'dir' ? toggle(n.path) : onOpen(n.path))}
              onContextMenu={(e) => {
                e.preventDefault();
                window.api.fs.reveal(n.path);
              }}
              title={n.path}
            >
              <span className="tree-icon">{n.type === 'dir' ? (isOpen ? '▾ 📂' : '▸ 📁') : fileIcon(n.name)}</span>
              <span className="tree-name">{n.name}</span>
              {hot && n.type === 'file' && <span className="badge">new</span>}
            </button>
            {n.type === 'dir' && isOpen && n.children && n.children.length > 0 && (
              <ul role="group">
                <Nodes
                  nodes={n.children}
                  depth={depth + 1}
                  open={open}
                  toggle={toggle}
                  activePath={activePath}
                  highlight={highlight}
                  onOpen={onOpen}
                />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}
