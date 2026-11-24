import React, { useCallback, useRef } from 'react';
import { Pause, Play } from 'lucide-react';

export const REALTIME_SLIDER_VAL = 1;
const SEC_PER_DAY = 86400;
const YEAR_SECONDS = 365.25 * SEC_PER_DAY; // 31,557,600
const MIN_SLIDER = -7;
const MAX_SLIDER = 7;

export function sliderToDaysPerSec(v: number): number {
  if (Math.abs(v) < 0.15) return 0;
  const sign = Math.sign(v);
  const a = Math.abs(v);
  if (a <= 1) {
    return sign * (a / SEC_PER_DAY);
  }
  return sign * (1 / SEC_PER_DAY) * Math.pow(YEAR_SECONDS, (a - 1) / 6);
}

export function formatCompactSpeed(daysPerSec: number): string {
  if (daysPerSec === 0) return '0×';
  const sign = daysPerSec < 0 ? '-' : '';
  const absDays = Math.abs(daysPerSec);
  const absSec = absDays * SEC_PER_DAY;

  if (absSec >= 0.95 && absSec <= 1.05) {
    return `${sign}1×`;
  }
  if (absSec < 1) {
    return `${sign}${absSec.toFixed(1)}×`;
  }
  if (absSec < 60) {
    return `${sign}${Math.round(absSec)}s`;
  }
  const absMin = absSec / 60;
  if (absMin < 60) {
    return `${sign}${Math.round(absMin)}m`;
  }
  const absHr = absMin / 60;
  if (absHr < 24) {
    return `${sign}${Math.round(absHr)}h`;
  }
  if (absDays < 30) {
    return `${sign}${absDays < 10 ? absDays.toFixed(1) : Math.round(absDays)}d`;
  }
  const absMo = absDays / 30.4375;
  if (absMo < 12) {
    return `${sign}${Math.round(absMo)}mo`;
  }
  const absYr = absDays / 365.25;
  return `${sign}${absYr >= 0.95 ? absYr.toFixed(1) : absYr.toFixed(2)}y`;
}

export function formatSpeedTooltip(daysPerSec: number): string {
  if (daysPerSec === 0) return 'Paused';
  const sign = daysPerSec < 0 ? '-' : '';
  const absDays = Math.abs(daysPerSec);
  const absSec = absDays * SEC_PER_DAY;

  if (absSec >= 0.95 && absSec <= 1.05) {
    return `${sign}1× Real Time`;
  }
  if (absSec < 1) {
    return `${sign}${absSec.toFixed(2)}× Real`;
  }
  if (absSec < 60) {
    return `${sign}${absSec < 10 ? absSec.toFixed(1) : Math.round(absSec)} s/s`;
  }
  const absMin = absSec / 60;
  if (absMin < 60) {
    return `${sign}${absMin < 10 ? absMin.toFixed(1) : Math.round(absMin)} m/s`;
  }
  const absHr = absMin / 60;
  if (absHr < 24) {
    return `${sign}${absHr < 10 ? absHr.toFixed(1) : Math.round(absHr)} hr/s`;
  }
  if (absDays < 30) {
    return `${sign}${absDays < 10 ? absDays.toFixed(1) : Math.round(absDays)} d/s`;
  }
  const absMo = absDays / 30.4375;
  if (absMo < 12) {
    return `${sign}${absMo < 10 ? absMo.toFixed(1) : Math.round(absMo)} mo/s`;
  }
  const absYr = absDays / 365.25;
  return `${sign}${absYr.toFixed(2)} yr/s`;
}

interface TimeControlPanelProps {
  sliderValue: number;
  onSliderChange: (val: number) => void;
  onTogglePlayPause: () => void;
  onResetRealTime: () => void;
  onJumpToNow: () => void;
}

export const TimeControlPanel: React.FC<TimeControlPanelProps> = React.memo(
  ({
    sliderValue,
    onSliderChange,
    onTogglePlayPause,
    onResetRealTime,
    onJumpToNow,
  }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);

    const daysPerSec = sliderToDaysPerSec(sliderValue);
    const isPaused = daysPerSec === 0;

    const updateFromClientY = useCallback(
      (clientY: number) => {
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const ratioFromTop = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
        const raw = MAX_SLIDER - ratioFromTop * (MAX_SLIDER - MIN_SLIDER);
        const snapped =
          Math.abs(raw) < 0.16
            ? 0
            : Math.abs(raw - 1) < 0.14
              ? 1
              : Math.abs(raw + 1) < 0.14
                ? -1
                : Math.round(raw * 20) / 20;
        onSliderChange(snapped);
      },
      [onSliderChange],
    );

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      updateFromClientY(e.clientY);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      updateFromClientY(e.clientY);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 0.5 : 0.2;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        onSliderChange(Math.min(MAX_SLIDER, Math.round((sliderValue + step) * 20) / 20));
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        onSliderChange(Math.max(MIN_SLIDER, Math.round((sliderValue - step) * 20) / 20));
      } else if (e.key === '0') {
        e.preventDefault();
        onSliderChange(0);
      }
    };

    const thumbPercent = ((MAX_SLIDER - sliderValue) / (MAX_SLIDER - MIN_SLIDER)) * 100;
    const fillTopPercent = sliderValue >= 0 ? thumbPercent : 50;
    const fillHeightPercent = Math.abs(50 - thumbPercent);

    return (
      <aside
        aria-label="Simulation time controls"
        className="fixed left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-2"
      >
        {/* Pill container for speed readout & vertical bidirectional slider */}
        <div className="flex flex-col items-center gap-2 w-10 rounded-full bg-white/12 backdrop-blur-md py-3 px-1.5">
          <button
            type="button"
            onClick={onResetRealTime}
            title={`${formatSpeedTooltip(daysPerSec)} · Click for 1× Real Time`}
            className={`w-full text-center font-mono-tech text-[10px] font-medium tabular-nums leading-tight py-0.5 rounded-full transition-colors cursor-pointer ${
              isPaused ? 'text-white/55 hover:text-white' : 'text-white hover:text-white/80'
            }`}
          >
            {formatCompactSpeed(daysPerSec)}
          </button>

          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Simulation time rate"
            aria-orientation="vertical"
            aria-valuemin={MIN_SLIDER}
            aria-valuemax={MAX_SLIDER}
            aria-valuenow={sliderValue}
            aria-valuetext={formatSpeedTooltip(daysPerSec)}
            title={`Time Rate: ${formatSpeedTooltip(daysPerSec)}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleKeyDown}
            className="relative h-36 w-7 flex items-center justify-center touch-none select-none cursor-ns-resize focus:outline-none group"
          >
            <div className="relative w-1.5 h-full rounded-full bg-white/20">
              {/* Center 0 tick */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-px bg-white/55"
              />
              {/* 1× real-time subtle tick */}
              <div
                aria-hidden="true"
                style={{ top: `${((MAX_SLIDER - 1) / (MAX_SLIDER - MIN_SLIDER)) * 100}%` }}
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-px bg-white/40"
              />

              {/* Active fill between center and thumb */}
              {!isPaused && (
                <div
                  aria-hidden="true"
                  style={{
                    top: `${fillTopPercent}%`,
                    height: `${fillHeightPercent}%`,
                  }}
                  className="pointer-events-none absolute inset-x-0 rounded-full bg-white/80"
                />
              )}

              {/* Thumb */}
              <div
                aria-hidden="true"
                style={{ top: `${thumbPercent}%` }}
                className={`pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-transform group-hover:scale-110 ${
                  isPaused ? 'bg-white/60' : 'bg-white'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Separated circular Pause & Now buttons */}
        <button
          type="button"
          onClick={onTogglePlayPause}
          aria-label={isPaused ? 'Resume orbital clock' : 'Pause orbital clock'}
          title={isPaused ? 'Resume (Space)' : 'Pause (Space)'}
          className={`flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md transition-colors cursor-pointer ${
            isPaused
              ? 'bg-white text-black'
              : 'bg-white/12 hover:bg-white/22 text-white'
          }`}
        >
          {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        </button>

        <button
          type="button"
          onClick={onJumpToNow}
          aria-label="Reset clock to current real-world UTC time"
          title="Jump to current UTC time"
          className="flex items-center justify-center w-9 h-9 rounded-full bg-white/12 hover:bg-white/22 backdrop-blur-md text-[10px] font-mono-tech font-medium text-white transition-colors cursor-pointer"
        >
          Now
        </button>
      </aside>
    );
  },
);

TimeControlPanel.displayName = 'TimeControlPanel';
