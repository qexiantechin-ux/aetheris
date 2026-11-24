import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Settings, X } from 'lucide-react';
import { PlanetariumSettings } from '../types/astronomy';

interface SettingsMenuProps {
  settings: PlanetariumSettings;
  onChange: (next: PlanetariumSettings) => void;
}

const DEFAULT_SETTINGS: PlanetariumSettings = {
  quality: 0.75,
  lensFlareSize: 1,
  lensFlareStrength: 1,
  showSkybox: true,
};

interface PillSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueLabel: string;
  onChange: (val: number) => void;
}

const PillSlider: React.FC<PillSliderProps> = ({
  id,
  label,
  value,
  min,
  max,
  step,
  valueLabel,
  onChange,
}) => {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="font-medium text-white/90">
          {label}
        </label>
        <span className="font-mono-tech text-[11px] text-white/70 tabular-nums">
          {valueLabel}
        </span>
      </div>
      <div className="relative h-5 flex items-center group">
        <div className="relative w-full h-1.5 rounded-full bg-white/18">
          <div
            aria-hidden="true"
            style={{ width: `${pct}%` }}
            className="h-full rounded-full bg-white/85"
          />
          <div
            aria-hidden="true"
            style={{ left: `${pct}%` }}
            className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white transition-transform group-hover:scale-110"
          />
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
        />
      </div>
    </div>
  );
};

export const SettingsMenu: React.FC<SettingsMenuProps> = React.memo(
  ({ settings, onChange }) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!open) return;
      const handleOutside = (e: MouseEvent) => {
        if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener('mousedown', handleOutside);
      return () => document.removeEventListener('mousedown', handleOutside);
    }, [open]);

    const qualityTierLabel =
      settings.quality >= 0.9
        ? 'Ultra'
        : settings.quality >= 0.7
          ? 'High'
          : settings.quality >= 0.45
            ? 'Medium'
            : 'Low';

    return (
      <section
        ref={rootRef}
        aria-label="Settings menu"
        className="fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2"
      >
        {open && (
          <div
            role="dialog"
            aria-label="Graphics and display settings"
            className="w-64 rounded-3xl bg-white/12 backdrop-blur-xl p-4 space-y-3.5 text-white"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-xs font-semibold tracking-wide uppercase text-white/85">
                Settings
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChange(DEFAULT_SETTINGS)}
                  aria-label="Reset settings to defaults"
                  title="Reset defaults"
                  className="flex items-center justify-center w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white/75 hover:text-white transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close settings"
                  className="flex items-center justify-center w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white/75 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            <PillSlider
              id="setting-quality"
              label="Quality"
              value={settings.quality}
              min={0.25}
              max={1}
              step={0.05}
              valueLabel={`${qualityTierLabel} · ${Math.round(settings.quality * 100)}%`}
              onChange={(quality) => onChange({ ...settings, quality })}
            />

            <PillSlider
              id="setting-flare-size"
              label="Lens Flare Size"
              value={settings.lensFlareSize}
              min={0}
              max={2}
              step={0.05}
              valueLabel={`${Math.round(settings.lensFlareSize * 100)}%`}
              onChange={(lensFlareSize) => onChange({ ...settings, lensFlareSize })}
            />

            <PillSlider
              id="setting-flare-strength"
              label="Lens Flare Strength"
              value={settings.lensFlareStrength}
              min={0}
              max={2}
              step={0.05}
              valueLabel={`${Math.round(settings.lensFlareStrength * 100)}%`}
              onChange={(lensFlareStrength) =>
                onChange({ ...settings, lensFlareStrength })
              }
            />

            <div className="flex items-center justify-between pt-0.5">
              <span className="text-xs font-medium text-white/90">
                Show Skybox
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.showSkybox}
                aria-label="Show Skybox"
                onClick={() =>
                  onChange({ ...settings, showSkybox: !settings.showSkybox })
                }
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                  settings.showSkybox ? 'bg-white' : 'bg-white/20'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`block w-3.5 h-3.5 rounded-full transition-transform ${
                    settings.showSkybox
                      ? 'translate-x-5.5 bg-black'
                      : 'translate-x-1 bg-white/85'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Settings"
          aria-expanded={open}
          title="Settings"
          className={`relative group flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md transition-colors cursor-pointer ${
            open
              ? 'bg-white text-black'
              : 'bg-white/12 text-white/80 hover:bg-white/22 hover:text-white'
          }`}
        >
          <Settings className="w-4 h-4" />
          {!open && (
            <span className="pointer-events-none absolute bottom-full right-0 mb-2 z-40 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
              Settings
            </span>
          )}
        </button>
      </section>
    );
  },
);

SettingsMenu.displayName = 'SettingsMenu';
