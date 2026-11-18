import { useEffect, useRef, useState } from 'react';

interface Props {
  output: string;
  runningId: string | null;
  onRun: (cmd: string) => void;
  onKill: () => void;
  onClear: () => void;
}

/** Strips ANSI color codes that some tools print even with FORCE_COLOR=0. */
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

export function TerminalPanel({ output, runningId, onRun, onKill, onClear }: Props) {
  const [cmd, setCmd] = useState('');
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  return (
    <div className="terminal">
      <div className="pane-head">
        <span>TERMINAL {runningId && <span className="running">● running</span>}</span>
        <span>
          {runningId && <button className="small" onClick={onKill}>Stop</button>}
          <button className="small" onClick={onClear}>Clear</button>
        </span>
      </div>
      <pre ref={ref} className="terminal-output">{stripAnsi(output) || 'Command output (npm install, test runs) appears here.'}</pre>
      <form
        className="terminal-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (cmd.trim() && !runningId) {
            onRun(cmd.trim());
            setCmd('');
          }
        }}
      >
        <span className="prompt">$</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder={runningId ? 'A command is running…' : 'Run a command in the project folder, e.g. npx playwright test tests/login.spec.ts'}
          disabled={!!runningId}
          aria-label="Terminal command"
        />
      </form>
    </div>
  );
}
