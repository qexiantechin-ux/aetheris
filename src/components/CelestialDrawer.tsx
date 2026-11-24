import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, Orbit, X } from 'lucide-react';
import { BODY_MAP, SOLAR_SYSTEM_BODIES } from '../data/solarSystem';
import {
  getStarComponentSolarRadius,
  getStarSolarRadius,
  NEARBY_STAR_MAP,
} from '../data/starCatalog';

interface CelestialDrawerProps {
  selectedId: string | null;
  selectedKind: 'celestial' | 'nearby-star' | null;
  selectedComponentId: string | null;
  hudCollapsed: boolean;
  onClose: () => void;
  onSelectTarget: (
    id: string,
    kind: 'celestial' | 'nearby-star',
    componentId?: string | null,
  ) => void;
  onSolarOverview?: () => void;
}

function formatStarPeriod(days: number): string {
  if (days <= 1) return 'Primary Anchor';
  if (days < 730) return `${days.toFixed(2)} days`;
  const years = days / 365.25;
  if (years >= 1_000_000) return `${(years / 1_000_000).toFixed(2)} Myr`;
  if (years >= 10_000) return `${Math.round(years).toLocaleString()} yr`;
  return `${years.toFixed(1)} yr`;
}

export const CelestialDrawer: React.FC<CelestialDrawerProps> = React.memo(
  ({
    selectedId,
    selectedKind,
    selectedComponentId,
    hudCollapsed,
    onClose,
    onSelectTarget,
  }) => {
    const [collapsed, setCollapsed] = useState(false);

    const celestialBody =
      selectedId && selectedKind === 'celestial' ? BODY_MAP.get(selectedId) ?? null : null;
    const nearbyStar =
      selectedId && selectedKind === 'nearby-star' ? NEARBY_STAR_MAP.get(selectedId) ?? null : null;

    const childMoons = useMemo(() => {
      if (!celestialBody) return [];
      return SOLAR_SYSTEM_BODIES.filter((b) => b.parentId === celestialBody.id && b.category === 'moon');
    }, [celestialBody]);

    const parentBody = useMemo(() => {
      if (!celestialBody?.parentId) return null;
      return BODY_MAP.get(celestialBody.parentId) ?? null;
    }, [celestialBody]);

    const physicalComponents = useMemo(() => {
      if (!nearbyStar?.components) return [];
      return nearbyStar.components.filter((c) => !c.isVirtualBarycenter);
    }, [nearbyStar]);

    const selectedComponent = useMemo(() => {
      if (!selectedComponentId || physicalComponents.length === 0) return null;
      return physicalComponents.find((c) => c.id === selectedComponentId) ?? null;
    }, [physicalComponents, selectedComponentId]);

    if ((!celestialBody && !nearbyStar) || hudCollapsed) {
      return null;
    }

    return (
      <aside
        aria-label="Celestial object dossier"
        className={`fixed top-14 md:top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col bg-white/12 backdrop-blur-md overflow-hidden pointer-events-auto ${
          collapsed
            ? 'w-fit min-w-[200px] max-w-[min(350px,calc(100vw-2rem))] rounded-full'
            : 'w-[350px] max-w-[calc(100vw-2rem)] max-h-[min(36vh,340px)] rounded-3xl'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <div
            onClick={() => setCollapsed((c) => !c)}
            className="min-w-0 flex-1 cursor-pointer select-none"
          >
            {!collapsed && parentBody && parentBody.id !== 'sun' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTarget(parentBody.id, 'celestial');
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 mb-1 rounded-full bg-white/12 hover:bg-white/22 text-[10px] text-white transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-2.5 h-2.5" />
                <span>Orbiting {parentBody.name}</span>
              </button>
            )}

            {!collapsed && nearbyStar && selectedComponent && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTarget(nearbyStar.id, 'nearby-star', null);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 mb-1 rounded-full bg-white/12 hover:bg-white/22 text-[10px] text-white transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-2.5 h-2.5" />
                <span>{nearbyStar.name} System Orbit</span>
              </button>
            )}

            <h2 className="font-display text-base font-semibold text-white leading-tight truncate">
              {selectedComponent
                ? selectedComponent.name
                : celestialBody
                  ? celestialBody.name
                  : nearbyStar?.name}
            </h2>

            {!collapsed && (
              <p className="text-[11px] text-white/65 mt-0.5 truncate">
                {celestialBody
                  ? `${celestialBody.classification} · ${celestialBody.telemetry.distanceLabel.split(' ')[0]}`
                  : selectedComponent && nearbyStar
                    ? `${selectedComponent.roleLabel ?? selectedComponent.spectralClass} · ${nearbyStar.constellation}`
                    : `${nearbyStar?.designation} · ${nearbyStar?.constellation}`}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand info box' : 'Collapse info box'}
              title={collapsed ? 'Expand' : 'Collapse'}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-white/12 hover:bg-white/25 text-white transition-colors cursor-pointer"
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close info box"
              title="Close"
              className="flex items-center justify-center w-7 h-7 rounded-full bg-white/12 hover:bg-white/25 text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Collapsible Body: Satellite / Component List & Physical Telemetry */}
        {!collapsed && (
          <div className="flex-1 overflow-y-auto observatory-scroll px-4 pb-3.5 pt-1 space-y-3">
            {celestialBody && childMoons.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-white/75">
                  Satellites ({childMoons.length})
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {childMoons.map((moon) => (
                    <button
                      key={moon.id}
                      type="button"
                      onClick={() => onSelectTarget(moon.id, 'celestial')}
                      className="flex items-center justify-between px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs text-white transition-colors cursor-pointer"
                    >
                      <span className="truncate">{moon.name}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-white/60 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {nearbyStar && physicalComponents.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-medium text-white/75">
                    Stellar Components ({physicalComponents.length})
                  </div>
                  {(nearbyStar.overviewSpanAu ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => onSelectTarget(nearbyStar.id, 'nearby-star', null)}
                      className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                        !selectedComponentId
                          ? 'bg-white text-black'
                          : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                      }`}
                    >
                      <Orbit className="w-3 h-3" />
                      <span>System Orbit</span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {physicalComponents.map((comp) => {
                    const isActive = selectedComponentId === comp.id;
                    return (
                      <button
                        key={comp.id}
                        type="button"
                        onClick={() => onSelectTarget(nearbyStar.id, 'nearby-star', comp.id)}
                        className={`flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-full text-left transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-white text-black'
                            : 'bg-white/10 hover:bg-white/20 text-white'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{comp.name}</div>
                          <div
                            className={`text-[10px] truncate ${
                              isActive ? 'text-black/70' : 'text-white/60'
                            }`}
                          >
                            {comp.roleLabel ?? comp.spectralClass}
                          </div>
                        </div>
                        <ChevronRight
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isActive ? 'text-black/60' : 'text-white/60'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {celestialBody && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-white/75">Physical Telemetry</div>
                <dl className="space-y-1 text-xs">
                  {[
                    ['Mean Radius', celestialBody.telemetry.radiusKm],
                    ['Mass', celestialBody.telemetry.massEarth],
                    ['Surface Gravity', celestialBody.telemetry.gravityMs2],
                    ['Distance', celestialBody.telemetry.distanceLabel],
                    ['Orbital Period', celestialBody.telemetry.orbitalPeriodLabel],
                    ['Sidereal Day', celestialBody.telemetry.dayLengthLabel],
                    ['Axial Tilt', `${celestialBody.axialTiltDeg}°`],
                    ['Orbital Inclination', `${celestialBody.inclinationDeg}°`],
                    ['Eccentricity', `${celestialBody.eccentricity}`],
                    ['Mean Temp', celestialBody.telemetry.meanTempC],
                    ['Atmosphere', celestialBody.telemetry.atmosphereSummary],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      className="flex items-baseline justify-between gap-3 px-3 py-1.5 rounded-full bg-white/8"
                    >
                      <dt className="text-white/65 shrink-0">{label}</dt>
                      <dd className="font-mono-tech text-white text-right truncate">{val}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {nearbyStar && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-white/75">Physical Telemetry</div>
                <dl className="space-y-1 text-xs">
                  {(selectedComponent
                    ? [
                        ['Spectral Class', selectedComponent.spectralClass],
                        ['Component Role', selectedComponent.roleLabel ?? 'Member Star'],
                        [
                          'Radius',
                          `${getStarComponentSolarRadius(selectedComponent).toFixed(
                            getStarComponentSolarRadius(selectedComponent) < 0.05 ? 4 : 2,
                          )} R☉`,
                        ],
                        ['Mass', `${selectedComponent.massSolar.toFixed(2)} M☉`],
                        [
                          'Luminosity',
                          selectedComponent.luminositySolar >= 1
                            ? `${selectedComponent.luminositySolar.toLocaleString()} L☉`
                            : `${selectedComponent.luminositySolar} L☉`,
                        ],
                        ['Effective Temp', `${selectedComponent.temperatureK.toLocaleString()} K`],
                        [
                          'Orbital Semi-Major',
                          selectedComponent.semiMajorAu > 0
                            ? `${selectedComponent.semiMajorAu.toLocaleString()} AU`
                            : 'Primary Anchor',
                        ],
                        ['Orbital Period', formatStarPeriod(selectedComponent.orbitalPeriodDays)],
                        ['Eccentricity', `${selectedComponent.eccentricity}`],
                        ['Inclination', `${selectedComponent.inclinationDeg}°`],
                        ['Distance from Sol', `${nearbyStar.distanceLy.toFixed(3)} light-years`],
                      ]
                    : [
                        ['Spectral Type', nearbyStar.spectralClass],
                        ['Estimated Radius', `${getStarSolarRadius(nearbyStar).toFixed(2)} R☉`],
                        ['Distance', `${nearbyStar.distanceLy.toFixed(3)} light-years`],
                        ['Luminosity', nearbyStar.luminositySolar],
                        ['Effective Temp', `${nearbyStar.temperatureK.toLocaleString()} K`],
                        ['Apparent Magnitude', `${nearbyStar.apparentMag}`],
                        ['Absolute Magnitude', `${nearbyStar.absoluteMag}`],
                        ['Known Exoplanets', `${nearbyStar.exoplanetsCount}`],
                        ['Right Ascension', `${nearbyStar.raHours.toFixed(3)} h`],
                        ['Declination', `${nearbyStar.decDeg.toFixed(2)}°`],
                        ['Constellation', nearbyStar.constellation],
                      ]
                  ).map(([label, val]) => (
                    <div
                      key={label}
                      className="flex items-baseline justify-between gap-3 px-3 py-1.5 rounded-full bg-white/8"
                    >
                      <dt className="text-white/65 shrink-0">{label}</dt>
                      <dd className="font-mono-tech text-white text-right truncate">{val}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )}
      </aside>
    );
  },
);

CelestialDrawer.displayName = 'CelestialDrawer';

