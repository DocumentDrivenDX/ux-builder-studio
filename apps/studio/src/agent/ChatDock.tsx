/* Where the App Expert's panel sits: docked on the right (its width dragged
   from its left edge), or floating over the studio, moved by its grip and
   resized from any edge or corner. The arrow keys do the same on the grip
   (Shift resizes), so neither needs a pointer. Its last state is kept in this
   browser's localStorage and restored, kept inside the window. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Button, Icon, registerIcons } from "@ux-builder/ui";
import { iconGripVertical, iconPanelRight, iconPictureInPicture2 } from "@ux-builder/ui/icons";

registerIcons(iconGripVertical, iconPanelRight, iconPictureInPicture2);

export type DockState = {
  mode: "docked" | "floating";
  /** Docked width, in CSS pixels. */
  width: number;
  /** Floating frame, in CSS pixels from the window's top left. */
  x: number;
  y: number;
  w: number;
  h: number;
};

const KEY = "ux-builder-studio.app-expert.dock";
const MIN_W = 320, MIN_H = 360, MAX_DOCK = 720, STEP = 16;
const DEFAULT: DockState = { mode: "docked", width: 380, x: 0, y: 0, w: 420, h: 640 };

function load(): DockState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && (v.mode === "docked" || v.mode === "floating")) return { ...DEFAULT, ...v };
  } catch {
    // Storage may be off or full; the default layout works without it.
  }
  return DEFAULT;
}
function save(s: DockState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // As above: the layout still works, it just isn't remembered.
  }
}

/* Keep a floating frame inside the window, with its grip reachable. */
function clamp(s: DockState): DockState {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(Math.max(s.w, MIN_W), vw - 16);
  const h = Math.min(Math.max(s.h, MIN_H), vh - 16);
  const x = Math.min(Math.max(s.x, 8), vw - w - 8);
  const y = Math.min(Math.max(s.y, 8), vh - h - 8);
  const width = Math.min(Math.max(s.width, MIN_W), Math.min(MAX_DOCK, vw - 360));
  return { ...s, w, h, x, y, width };
}

type Dock = { state: DockState; toggle: () => void; gripProps: Record<string, unknown>; onGripKey: (e: KeyboardEvent<HTMLElement>) => void };
const DockContext = createContext<Dock | null>(null);
export const useDock = () => useContext(DockContext);

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function ChatDock({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DockState>(() => clamp(load()));
  const drag = useRef<{ kind: "move" | Edge | "dock-width"; px: number; py: number; start: DockState } | null>(null);

  const update = useCallback((next: DockState) => {
    const c = clamp(next);
    setState(c);
    save(c);
  }, []);
  useEffect(() => {
    const onResize = () => setState((s) => clamp(s));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggle = () => {
    if (state.mode === "docked") {
      // Float where it was docked, at its docked width.
      const w = Math.max(state.width, 400);
      update({ ...state, mode: "floating", w, h: Math.min(state.h || 640, window.innerHeight - 96), x: window.innerWidth - w - 24, y: 72 });
    } else {
      update({ ...state, mode: "docked" });
    }
  };

  const begin = (kind: "move" | Edge | "dock-width") => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    // A press on a control inside the grip (a button) is that control's, not a drag.
    if (kind === "move" && (e.target as HTMLElement).closest("button, a, [role=menu], input, textarea, select")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, px: e.clientX, py: e.clientY, start: state };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py, s = d.start;
    if (d.kind === "dock-width") return setState(clamp({ ...s, width: s.width - dx }));
    if (d.kind === "move") return setState(clamp({ ...s, x: s.x + dx, y: s.y + dy }));
    let { x, y, w, h } = s;
    if (d.kind.includes("e")) w = s.w + dx;
    if (d.kind.includes("s")) h = s.h + dy;
    if (d.kind.includes("w")) { w = Math.max(MIN_W, s.w - dx); x = s.x + (s.w - w); }
    if (d.kind.includes("n")) { h = Math.max(MIN_H, s.h - dy); y = s.y + (s.h - h); }
    setState(clamp({ ...s, x, y, w, h }));
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setState((s) => (save(s), s));
  };

  /* The grip by keyboard: arrows move a floating panel (Shift + arrows resize it). */
  const onGripKey = (e: KeyboardEvent<HTMLElement>) => {
    if (state.mode !== "floating") return;
    const d = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key];
    if (!d) return;
    e.preventDefault();
    update(e.shiftKey ? { ...state, w: state.w + d[0], h: state.h + d[1] } : { ...state, x: state.x + d[0], y: state.y + d[1] });
  };

  const floating = state.mode === "floating";
  const style: CSSProperties = floating
    ? { position: "fixed", left: state.x, top: state.y, width: state.w, height: state.h }
    : ({ "--studio-chat-width": `${state.width}px` } as CSSProperties);
  const gripProps = floating
    ? { onPointerDown: begin("move"), onPointerMove: move, onPointerUp: end, onPointerCancel: end, "data-grip": "" }
    : {};

  return (
    <DockContext.Provider value={{ state, toggle, gripProps, onGripKey }}>
      <div className="studio-dock" data-mode={state.mode} style={style}>
        {floating ? (
          EDGES.map((edge) => (
            <span key={edge} className="studio-dock__edge" data-edge={edge} aria-hidden="true"
              onPointerDown={begin(edge)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
          ))
        ) : (
          <span className="studio-dock__edge" data-edge="dock" aria-hidden="true"
            onPointerDown={begin("dock-width")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        )}
        {children}
      </div>
    </DockContext.Provider>
  );
}

/* The header's controls for the dock: a grip (drag, or arrow keys) while floating, and dock / undock. */
export function DockControls() {
  const dock = useDock();
  if (!dock) return null;
  const floating = dock.state.mode === "floating";
  return (
    <>
      {floating ? (
        <button type="button" className="studio-dock__grip" aria-label="Move the App Expert panel (arrow keys; Shift and arrow keys resize it)"
          title="Drag to move" onKeyDown={dock.onGripKey}>
          <Icon name="grip-vertical" />
        </button>
      ) : null}
      <Button variant="text" size="sm" onClick={dock.toggle} aria-label={floating ? "Dock the App Expert panel on the right" : "Undock the App Expert panel so it floats"} title={floating ? "Dock" : "Undock"}>
        <Icon name={floating ? "panel-right" : "picture-in-picture-2"} />
      </Button>
    </>
  );
}
