import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Compass,
  Layers,
  Orbit,
  Sparkles,
  Tag,
} from 'lucide-react';
import { LayerVisibility } from '../types/astronomy';

interface VisibilityMenuProps {
  layers: LayerVisibility;
  onToggleLayer: (key: keyof LayerVisibility) => void;
}

const VISIBILITY_ITEMS: Array<{
  key: keyof LayerVisibility;
  label: string;
  Icon: React.FC<{ className?: string }>;
}> = [
  { key: 'orbits', label: 'Orbits', Icon: Orbit },
  { key: 'dwarfOrbits', label: 'Dwarf / DPC Orbits', Icon: CircleDashed },
  { key: 'labels', label: 'Labels', Icon: Tag },
  { key: 'asteroids', label: 'Asteroid Belt', Icon: Sparkles },
  { key: 'constellations', label: 'Constellations', Icon: Compass },
];

export const VisibilityMenu: React.FC<VisibilityMenuProps> = React.memo(
  ({ layers, onToggleLayer }) => {
    const [open, setOpen] = useState(false);

    const activeCount = VISIBILITY_ITEMS.reduce(
      (acc, item) => acc + (layers[item.key] ? 1 : 0),
      0,
    );

    return (
      <section
        aria-label="Visibility layers menu"
        className="fixed right-4 top-[58px] z-20 flex flex-col items-end gap-2"
      >
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/12 hover:bg-white/20 backdrop-blur-md text-xs font-medium text-white transition-colors cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5 text-white" />
          <span>Visibility</span>
          <span className="font-mono-tech text-[11px] text-white/70 tabular-nums">
            {activeCount}/{VISIBILITY_ITEMS.length}
          </span>
          {open ? (
            <ChevronUp className="w-3.5 h-3.5 text-white/70" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-white/70" />
          )}
        </button>

        {open && (
          <div className="flex items-center gap-2">
            {VISIBILITY_ITEMS.map(({ key, label, Icon }, idx) => {
              const active = layers[key];
              const isLast = idx === VISIBILITY_ITEMS.length - 1;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onToggleLayer(key)}
                  aria-label={label}
                  aria-pressed={active}
                  title={label}
                  className={`relative group flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md transition-colors cursor-pointer ${
                    active
                      ? 'bg-white text-black'
                      : 'bg-white/12 text-white/75 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span
                    className={`pointer-events-none absolute top-full mt-2 z-40 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity ${
                      isLast ? 'right-0' : 'left-1/2 -translate-x-1/2'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  },
);

VisibilityMenu.displayName = 'VisibilityMenu';
