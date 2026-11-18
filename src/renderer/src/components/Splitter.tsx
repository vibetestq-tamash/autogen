import { useRef } from 'react';

/** Drag handle between panes. Reports the mouse movement since the last event. */
export function Splitter({ onDrag, vertical }: { onDrag: (delta: number) => void; vertical?: boolean }) {
  const last = useRef(0);
  return (
    <div
      className={`splitter ${vertical ? 'vertical' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        last.current = vertical ? e.clientY : e.clientX;
        const move = (ev: MouseEvent) => {
          const pos = vertical ? ev.clientY : ev.clientX;
          onDrag(pos - last.current);
          last.current = pos;
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          document.body.classList.remove('dragging');
        };
        document.body.classList.add('dragging');
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    />
  );
}
