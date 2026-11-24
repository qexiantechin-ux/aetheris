import React, { useImperativeHandle, useRef, forwardRef } from 'react';
import { SOLAR_SYSTEM_BODIES } from '../data/solarSystem';
import { NEARBY_STARS } from '../data/starCatalog';
import { MarkerProjection } from '../types/astronomy';

export interface ScreenMarkersHandle {
  updateMarkers: (markers: MarkerProjection[]) => void;
}

interface ScreenMarkersOverlayProps {
  visible: boolean;
  onSelectTarget: (
    id: string,
    kind: 'celestial' | 'nearby-star',
    componentId?: string | null,
  ) => void;
}

interface MarkerDomState {
  x: number;
  y: number;
  opacity: number;
  selected: boolean;
  name: string;
  active: boolean;
  interactive: boolean;
}

export const ScreenMarkersOverlay = React.memo(
  forwardRef<ScreenMarkersHandle, ScreenMarkersOverlayProps>(({ visible, onSelectTarget }, ref) => {
    const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const nameRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
    const domStateRef = useRef<Map<string, MarkerDomState>>(new Map());
    const prevActiveRef = useRef<Set<string>>(new Set());
    const currActiveRef = useRef<Set<string>>(new Set());

    // Pre-register all marker slots so DOM positioning updates directly via refs at 60fps with zero React re-renders
    const markerTargets = React.useMemo(() => {
      const solar = SOLAR_SYSTEM_BODIES.map((b) => ({
        id: b.id,
        targetId: b.id,
        componentId: undefined as string | undefined,
        defaultName: b.name,
        kind: 'celestial' as const,
      }));
      const namedStars = NEARBY_STARS.map((s) => ({
        id: s.id,
        targetId: s.id,
        componentId: undefined as string | undefined,
        defaultName: s.name,
        kind: 'nearby-star' as const,
      }));
      const starComponents = NEARBY_STARS.flatMap((s) =>
        (s.components ?? [])
          .filter((c) => !c.isVirtualBarycenter)
          .map((c) => ({
            id: `${s.id}::${c.id}`,
            targetId: s.id,
            componentId: c.id as string | undefined,
            defaultName: c.name,
            kind: 'nearby-star' as const,
          })),
      );
      return [...solar, ...namedStars, ...starComponents];
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        updateMarkers: (markers: MarkerProjection[]) => {
          const prevActive = prevActiveRef.current;
          const currActive = currActiveRef.current;
          const states = domStateRef.current;
          currActive.clear();

          for (let i = 0; i < markers.length; i++) {
            const m = markers[i];
            const el = itemRefs.current.get(m.id);
            if (!el) continue;

            currActive.add(m.id);

            let st = states.get(m.id);
            if (!st) {
              st = {
                x: NaN,
                y: NaN,
                opacity: -1,
                selected: false,
                name: m.name,
                active: false,
                interactive: false,
              };
              states.set(m.id, st);
            }

            const targetOp = Math.round(m.opacity * 100) / 100;
            const targetInteractive = m.opacity > 0.15;

            if (!st.active) {
              el.style.visibility = 'visible';
              st.active = true;
            }

            if (!(Math.abs(st.x - m.x) < 0.08 && Math.abs(st.y - m.y) < 0.08)) {
              el.style.transform = `translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
              st.x = m.x;
              st.y = m.y;
            }

            if (st.opacity !== targetOp) {
              el.style.opacity = targetOp.toFixed(2);
              st.opacity = targetOp;
            }

            if (st.interactive !== targetInteractive) {
              el.style.pointerEvents = targetInteractive ? 'auto' : 'none';
              st.interactive = targetInteractive;
            }

            if (st.selected !== m.isSelected) {
              el.dataset.selected = m.isSelected ? 'true' : 'false';
              st.selected = m.isSelected;
            }

            if (st.name !== m.name) {
              const labelEl = nameRefs.current.get(m.id);
              if (labelEl) labelEl.textContent = m.name;
              st.name = m.name;
            }
          }

          for (const id of prevActive) {
            if (!currActive.has(id)) {
              const el = itemRefs.current.get(id);
              const st = states.get(id);
              if (el) {
                el.style.opacity = '0';
                el.style.visibility = 'hidden';
                el.style.pointerEvents = 'none';
              }
              if (st) {
                st.active = false;
                st.opacity = 0;
                st.interactive = false;
              }
            }
          }

          prevActiveRef.current = currActive;
          currActiveRef.current = prevActive;
        },
      }),
      [],
    );

    return (
      <div
        className="fixed inset-0 z-10 pointer-events-none overflow-hidden"
        style={{ display: visible ? undefined : 'none' }}
      >
        {markerTargets.map((item) => (
          <button
            key={item.id}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(item.id, el);
                if (!domStateRef.current.has(item.id)) {
                  el.style.opacity = '0';
                  el.style.visibility = 'hidden';
                  el.style.pointerEvents = 'none';
                  domStateRef.current.set(item.id, {
                    x: NaN,
                    y: NaN,
                    opacity: 0,
                    selected: false,
                    name: item.defaultName,
                    active: false,
                    interactive: false,
                  });
                }
              } else {
                itemRefs.current.delete(item.id);
                domStateRef.current.delete(item.id);
              }
            }}
            type="button"
            onClick={() => onSelectTarget(item.targetId, item.kind, item.componentId ?? null)}
            className="group absolute top-0 left-0 px-1 py-0.5 cursor-pointer focus:outline-none"
          >
            <span
              ref={(el) => {
                if (el) nameRefs.current.set(item.id, el);
                else nameRefs.current.delete(item.id);
              }}
              className="text-[11px] font-medium tracking-wide text-white/90 group-hover:text-white group-data-[selected=true]:text-white group-data-[selected=true]:font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,0.95)] whitespace-nowrap"
            >
              {item.defaultName}
            </span>
          </button>
        ))}
      </div>
    );
  }),
);

ScreenMarkersOverlay.displayName = 'ScreenMarkersOverlay';
