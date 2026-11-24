import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Film } from 'lucide-react';
import { BottomDock, BottomDockHandle } from './components/BottomDock';
import { CelestialDrawer } from './components/CelestialDrawer';
import {
  ScreenMarkersHandle,
  ScreenMarkersOverlay,
} from './components/ScreenMarkersOverlay';
import {
  REALTIME_SLIDER_VAL,
  sliderToDaysPerSec,
  TimeControlPanel,
} from './components/TimeControlPanel';
import { TopBar } from './components/TopBar';
import { VisibilityMenu } from './components/VisibilityMenu';
import { SettingsMenu } from './components/SettingsMenu';
import {
  getPlanetAndStarDetails,
  PlanetariumEngine,
} from './engine/PlanetariumEngine';
import {
  CameraRegime,
  LayerVisibility,
  PlanetariumSettings,
  ScaleMode,
} from './types/astronomy';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PlanetariumEngine | null>(null);
  const markersRef = useRef<ScreenMarkersHandle>(null);
  const bottomDockRef = useRef<BottomDockHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastActiveSliderRef = useRef<number>(REALTIME_SLIDER_VAL);

  const [scaleMode, setScaleMode] = useState<ScaleMode>('true');
  const [timeSlider, setTimeSlider] = useState<number>(REALTIME_SLIDER_VAL);
  const [layers, setLayers] = useState<LayerVisibility>({
    orbits: true,
    dwarfOrbits: false,
    labels: true,
    constellations: false,
    asteroids: true,
  });
  const [settings, setSettings] = useState<PlanetariumSettings>({
    quality: 0.75,
    lensFlareSize: 1,
    lensFlareStrength: 1,
    showSkybox: true,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<
    'celestial' | 'nearby-star' | null
  >(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<{
    id: string;
    kind: 'celestial' | 'nearby-star';
  } | null>(null);
  const [regime, setRegime] = useState<CameraRegime>('solar');
  const [contextLost, setContextLost] = useState<boolean>(false);
  const [cinemaMode, setCinemaMode] = useState<boolean>(false);

  // Initialize isolated Three.js engine once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const engine = new PlanetariumEngine(container, {
      onSelectTarget: (id, kind, componentId) => {
        setSelectedId(id);
        setSelectedKind(kind);
        setSelectedComponentId(componentId ?? null);
      },
      onHoverTarget: (id, kind) => {
        setHoveredTarget(id && kind ? { id, kind } : null);
      },
      onRegimeChange: (newRegime) => {
        setRegime((prev) => (prev === newRegime ? prev : newRegime));
      },
      onSimTimeTick: (days) => {
        bottomDockRef.current?.updateTime(days);
      },
      onMarkersFrame: (markers) => {
        markersRef.current?.updateMarkers(markers);
      },
      onWebGLContextLost: (lost) => {
        setContextLost(lost);
      },
    });

    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleSelectTarget = useCallback(
    (
      id: string,
      kind: 'celestial' | 'nearby-star',
      componentId?: string | null,
    ) => {
      engineRef.current?.selectAndFlyTo(id, kind, componentId ?? null);
    },
    [],
  );

  const handleScaleModeChange = useCallback((mode: ScaleMode) => {
    setScaleMode(mode);
    engineRef.current?.setScaleMode(mode);
  }, []);

  const handleTimeSliderChange = useCallback((val: number) => {
    setTimeSlider(val);
    const daysPerSec = sliderToDaysPerSec(val);
    if (daysPerSec !== 0) {
      lastActiveSliderRef.current = val;
    }
    engineRef.current?.setTimeSpeed(daysPerSec);
  }, []);

  const handleTogglePlayPause = useCallback(() => {
    const currentSpeed = sliderToDaysPerSec(timeSlider);
    if (currentSpeed === 0) {
      const resumeVal =
        sliderToDaysPerSec(lastActiveSliderRef.current) !== 0
          ? lastActiveSliderRef.current
          : REALTIME_SLIDER_VAL;
      handleTimeSliderChange(resumeVal);
    } else {
      handleTimeSliderChange(0);
    }
  }, [timeSlider, handleTimeSliderChange]);

  const handleResetRealTime = useCallback(() => {
    handleTimeSliderChange(REALTIME_SLIDER_VAL);
  }, [handleTimeSliderChange]);

  const handleJumpToNow = useCallback(() => {
    engineRef.current?.jumpToNow();
  }, []);

  const handleToggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      engineRef.current?.setLayers(next);
      return next;
    });
  }, []);

  const handleSettingsChange = useCallback((next: PlanetariumSettings) => {
    setSettings(next);
    engineRef.current?.setSettings(next);
  }, []);

  const handleZoomSolar = useCallback(() => {
    engineRef.current?.zoomToSolarOverview();
  }, []);

  const handleZoomInterstellar = useCallback(() => {
    engineRef.current?.zoomToInterstellarView();
  }, []);

  const handleCloseDrawer = useCallback(() => {
    engineRef.current?.selectAndFlyTo(null, null);
  }, []);

  // Keyboard shortcuts: Space (play/pause), Esc (close/overview), / (search)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isTyping = activeTag === 'input' || activeTag === 'textarea';

      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'Escape') {
        if (isTyping) {
          (document.activeElement as HTMLElement).blur();
          return;
        }
        if (cinemaMode) {
          setCinemaMode(false);
          return;
        }
        if (selectedId) {
          handleCloseDrawer();
        }
        return;
      }

      if (isTyping) return;

      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setCinemaMode((prev) => !prev);
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlayPause();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, cinemaMode, handleCloseDrawer, handleTogglePlayPause]);

  const hoveredInfo = hoveredTarget
    ? getPlanetAndStarDetails(hoveredTarget.id, hoveredTarget.kind)
    : null;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black text-slate-100">
      {/* Dedicated isolated WebGL canvas mount */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {/* 60fps Projected Reticle Labels */}
      <ScreenMarkersOverlay
        ref={markersRef}
        visible={layers.labels && !cinemaMode}
        onSelectTarget={handleSelectTarget}
      />

      {/* Top Navigation & Quick-Jump Search */}
      {!cinemaMode && (
        <TopBar
          regime={regime}
          onZoomSolar={handleZoomSolar}
          onZoomInterstellar={handleZoomInterstellar}
          scaleMode={scaleMode}
          onScaleModeChange={handleScaleModeChange}
          onSelectTarget={handleSelectTarget}
          searchInputRef={searchInputRef}
        />
      )}

      {/* Compact Collapsible Visibility Menu */}
      {!cinemaMode && (
        <VisibilityMenu layers={layers} onToggleLayer={handleToggleLayer} />
      )}

      {/* Compact Vertical Time Rate Slider + Pause / Now Controls */}
      {!cinemaMode && (
        <TimeControlPanel
          sliderValue={timeSlider}
          onSliderChange={handleTimeSliderChange}
          onTogglePlayPause={handleTogglePlayPause}
          onResetRealTime={handleResetRealTime}
          onJumpToNow={handleJumpToNow}
        />
      )}

      {/* Contextual Celestial Telemetry Dossier */}
      <CelestialDrawer
        selectedId={selectedId}
        selectedKind={selectedKind}
        selectedComponentId={selectedComponentId}
        hudCollapsed={cinemaMode}
        onClose={handleCloseDrawer}
        onSelectTarget={handleSelectTarget}
        onSolarOverview={handleZoomSolar}
      />

      {/* Discrete Hover Readout (Bottom-Left, zero overlap) */}
      {!cinemaMode && hoveredInfo && (
        <div className="fixed bottom-4 left-4 z-20 pointer-events-none px-3.5 py-1.5 rounded-full bg-white/12 backdrop-blur-md text-xs">
          <span className="font-display font-medium text-white">
            {hoveredInfo.name}
          </span>
          <span className="text-white/45 mx-1.5">·</span>
          <span className="text-white/75">
            {'classification' in hoveredInfo
              ? hoveredInfo.classification
              : `${hoveredInfo.spectralClass} · ${hoveredInfo.distanceLy} ly`}
          </span>
        </div>
      )}

      {/* Bottom Simulation Clock */}
      <BottomDock ref={bottomDockRef} visible={!cinemaMode} />

      {/* Separated Circular Cinema Mode Toggle */}
      <button
        type="button"
        onClick={() => setCinemaMode((prev) => !prev)}
        aria-label={cinemaMode ? 'Exit Cinema Mode' : 'Cinema Mode'}
        aria-pressed={cinemaMode}
        title={cinemaMode ? 'Exit Cinema Mode (H)' : 'Cinema Mode (H)'}
        className={`fixed bottom-4 right-[60px] z-40 group flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md transition-all cursor-pointer ${
          cinemaMode
            ? 'bg-white/10 text-white/60 hover:bg-white/22 hover:text-white opacity-60 hover:opacity-100'
            : 'bg-white/12 text-white/80 hover:bg-white/22 hover:text-white'
        }`}
      >
        {cinemaMode ? <Eye className="w-4 h-4" /> : <Film className="w-4 h-4" />}
        <span className="pointer-events-none absolute bottom-full right-0 mb-2 z-40 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
          {cinemaMode ? 'Exit Cinema Mode' : 'Cinema Mode'}
        </span>
      </button>

      {/* Bottom-Right Settings Menu */}
      {!cinemaMode && (
        <SettingsMenu settings={settings} onChange={handleSettingsChange} />
      )}

      {/* WebGL Context Loss Fallback */}
      {contextLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6">
          <div className="max-w-md rounded-3xl bg-white/12 backdrop-blur-xl p-6 text-center space-y-3">
            <h2 className="font-display text-lg font-semibold text-white">
              WebGL Graphics Context Suspended
            </h2>
            <p className="text-sm text-white/75">
              Your browser paused GPU rendering. Waiting for context restoration or reload the page to resume the 3D planetarium.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
