import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Orbit, Ruler, Scale, Search, Sparkles, X } from 'lucide-react';
import { SOLAR_SYSTEM_BODIES } from '../data/solarSystem';
import { NEARBY_STARS } from '../data/starCatalog';
import { CameraRegime, ScaleMode, SearchableTarget } from '../types/astronomy';

interface TopBarProps {
  regime: CameraRegime;
  onZoomSolar: () => void;
  onZoomInterstellar: () => void;
  scaleMode: ScaleMode;
  onScaleModeChange: (mode: ScaleMode) => void;
  onSelectTarget: (
    id: string,
    kind: 'celestial' | 'nearby-star',
    componentId?: string | null,
  ) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export const TopBar: React.FC<TopBarProps> = React.memo(
  ({
    regime,
    onZoomSolar,
    onZoomInterstellar,
    scaleMode,
    onScaleModeChange,
    onSelectTarget,
    searchInputRef,
  }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allTargets = useMemo<SearchableTarget[]>(() => {
    const solar: SearchableTarget[] = SOLAR_SYSTEM_BODIES.map((b) => ({
      id: b.id,
      name: b.name,
      subtitle: `${b.classification} · ${b.telemetry.distanceLabel.split(' ')[0]}`,
      kind: 'celestial',
      categoryLabel:
        b.category === 'moon'
          ? 'Moon'
          : b.category === 'star'
            ? 'Star'
            : b.category === 'dwarf'
              ? b.isDwarfCandidate
                ? 'Candidate'
                : 'Dwarf Planet'
              : 'Planet',
      accentColor: b.orbitColor,
    }));

    const stars: SearchableTarget[] = NEARBY_STARS.map((s) => ({
      id: s.id,
      name: s.name,
      subtitle: `${s.spectralClass} · ${s.distanceLy} ly · ${s.constellation}`,
      kind: 'nearby-star',
      categoryLabel: s.components?.length ? 'Multi-Star' : 'Star',
      accentColor: s.color,
    }));

    const starComponents: SearchableTarget[] = NEARBY_STARS.flatMap((s) =>
      (s.components ?? [])
        .filter((c) => !c.isVirtualBarycenter)
        .map((c) => ({
          id: s.id,
          componentId: c.id,
          name: c.name,
          subtitle: `${c.spectralClass} · ${s.name} System · ${s.distanceLy} ly`,
          kind: 'nearby-star' as const,
          categoryLabel: 'Member Star',
          accentColor: c.orbitColor,
        })),
    );

    return [...solar, ...stars, ...starComponents];
  }, []);

  const defaultTargets = useMemo(() => {
    const coreSolar = SOLAR_SYSTEM_BODIES.filter(
      (b) =>
        b.category === 'star' ||
        b.category === 'planet' ||
        (b.category === 'dwarf' && !b.isDwarfCandidate) ||
        b.id === 'moon',
    ).map((b) => allTargets.find((t) => t.kind === 'celestial' && t.id === b.id)!);
    const featuredStars = allTargets.filter((t) => t.kind === 'nearby-star').slice(0, 6);
    return [...coreSolar, ...featuredStars].slice(0, 20);
  }, [allTargets]);

  const filteredTargets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return defaultTargets;
    }
    return allTargets
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.subtitle.toLowerCase().includes(q) ||
          t.categoryLabel.toLowerCase().includes(q),
      )
      .slice(0, 14);
  }, [query, allTargets, defaultTargets]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between gap-4 px-4 py-3 pointer-events-none">
      {/* Top-Left Separated Circular Icon Buttons: Solar System, Nearby Stars, Balanced View, True Scale */}
      <div
        className="pointer-events-auto flex items-center gap-3.5 shrink-0"
        role="toolbar"
        aria-label="View and scale controls"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onZoomSolar}
            aria-label="Solar System"
            aria-pressed={regime !== 'interstellar'}
            title="Solar System"
            className={`relative group flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md transition-colors cursor-pointer ${
              regime !== 'interstellar'
                ? 'bg-white text-black'
                : 'bg-white/12 text-white/80 hover:bg-white/22 hover:text-white'
            }`}
          >
            <Orbit className="w-4 h-4" />
            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-40 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
              Solar System
            </span>
          </button>

          <button
            type="button"
            onClick={onZoomInterstellar}
            aria-label="Nearby Stars"
            aria-pressed={regime === 'interstellar'}
            title="Nearby Stars"
            className={`relative group flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md transition-colors cursor-pointer ${
              regime === 'interstellar'
                ? 'bg-white text-black'
                : 'bg-white/12 text-white/80 hover:bg-white/22 hover:text-white'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-40 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
              Nearby Stars
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onScaleModeChange('balanced')}
            aria-label="Balanced View"
            aria-pressed={scaleMode === 'balanced'}
            title="Balanced View"
            className={`relative group flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md transition-colors cursor-pointer ${
              scaleMode === 'balanced'
                ? 'bg-white text-black'
                : 'bg-white/12 text-white/80 hover:bg-white/22 hover:text-white'
            }`}
          >
            <Scale className="w-4 h-4" />
            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-40 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
              Balanced View
            </span>
          </button>

          <button
            type="button"
            onClick={() => onScaleModeChange('true')}
            aria-label="True Scale"
            aria-pressed={scaleMode === 'true'}
            title="True Scale"
            className={`relative group flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md transition-colors cursor-pointer ${
              scaleMode === 'true'
                ? 'bg-white text-black'
                : 'bg-white/12 text-white/80 hover:bg-white/22 hover:text-white'
            }`}
          >
            <Ruler className="w-4 h-4" />
            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-40 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
              True Scale
            </span>
          </button>
        </div>
      </div>

      {/* Top-Right Pill Quick-Jump Search */}
      <div className="pointer-events-auto flex items-center shrink-0">
        <div ref={dropdownRef} className="relative w-56 sm:w-72">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/12 focus-within:bg-white/18 transition-colors backdrop-blur-md">
            <Search className="w-4 h-4 text-white/75 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              placeholder="Jump to planet, moon, or star (/)"
              className="w-full bg-transparent text-sm text-white placeholder:text-white/50 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="flex items-center justify-center w-5 h-5 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {open && (
            <div className="absolute left-0 right-0 mt-2 max-h-80 overflow-y-auto observatory-scroll rounded-3xl bg-white/12 backdrop-blur-xl p-1.5 space-y-0.5 z-40">
              {filteredTargets.length === 0 ? (
                <div className="px-3.5 py-3 text-xs text-white/65">
                  No matching celestial bodies or catalogued stars.
                </div>
              ) : (
                filteredTargets.map((item) => (
                  <button
                    key={item.componentId ? `${item.id}::${item.componentId}` : item.id}
                    type="button"
                    onClick={() => {
                      onSelectTarget(item.id, item.kind, item.componentId ?? null);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-full text-left hover:bg-white/15 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-white/75 shrink-0" />
                        <span className="text-sm font-medium text-white truncate">
                          {item.name}
                        </span>
                      </div>
                      <div className="text-xs text-white/60 truncate pl-3.5">
                        {item.subtitle}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-white/12 font-mono-tech text-[10px] text-white/85 shrink-0">
                      {item.categoryLabel}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
});

TopBar.displayName = 'TopBar';
