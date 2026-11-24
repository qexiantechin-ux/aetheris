import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { formatJ2000ToUtcString } from '../engine/PlanetariumEngine';

export interface BottomDockHandle {
  updateTime: (simDays: number) => void;
}

interface BottomDockProps {
  visible?: boolean;
}

const INITIAL_SIM_DAYS = (() => {
  const j2000Ms = Date.UTC(2000, 0, 1, 12, 0, 0);
  return (Date.now() - j2000Ms) / 86400000;
})();

export const BottomDock = React.memo(
  forwardRef<BottomDockHandle, BottomDockProps>(({ visible = true }, ref) => {
    const textRef = useRef<HTMLDivElement>(null);
    const lastTextRef = useRef<string>('');

    useImperativeHandle(
      ref,
      () => ({
        updateTime: (simDays: number) => {
          const el = textRef.current;
          if (!el) return;
          const next = formatJ2000ToUtcString(simDays);
          if (next !== lastTextRef.current) {
            lastTextRef.current = next;
            el.textContent = next;
          }
        },
      }),
      [],
    );

    return (
      <div
        className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none ${
          visible ? '' : 'hidden'
        }`}
      >
        <div
          ref={textRef}
          aria-label="Simulation clock"
          className="px-4 py-1.5 rounded-full bg-white/12 backdrop-blur-md font-mono-tech text-xs text-white tabular-nums whitespace-nowrap"
        >
          {formatJ2000ToUtcString(INITIAL_SIM_DAYS)}
        </div>
      </div>
    );
  }),
);

BottomDock.displayName = 'BottomDock';
