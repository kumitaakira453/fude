import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { PHASE_LABEL } from "../lib/claude";
import { colorVar, type Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { PHASE_COLOR, phaseForAtom } from "../state/claude";
import { barAtom, visitedAtom } from "../state/workspaceBar";

// ⌘J（または ⌃Tab）の一覧。macOS の ⌘Tab と同じく、⌘ を押したまま J で送り、
// ⌘ を離したところで移る。すぐ離せば直前のワークスペースへ（一覧は出さない）。
// 並べるのはツールバーの札と同じもので、最近開いた順。

// 押してからこの間に離せば、一覧を出さずに移る（素早い行き来でちらつかせない）。
const SHOW_AFTER_MS = 150;

// 札の並びを、最近開いた順に並べ替える（今いるものが先頭）。
export function cycleOrder(
  bar: readonly string[],
  visited: readonly string[],
  current: string | undefined,
): string[] {
  const seen = visited.filter((id) => bar.includes(id));
  const head = current && bar.includes(current) ? [current] : [];
  const rest = [...seen, ...bar].filter((id) => !head.includes(id));
  return [...head, ...new Set(rest)];
}

// 一覧を送るキーなら、押したままにしている修飾キーを返す。
function holdOf(e: KeyboardEvent): "Meta" | "Control" | null {
  if (e.altKey) return null;
  if (e.metaKey && !e.ctrlKey && (e.code === "KeyJ" || e.key.toLowerCase() === "j")) {
    return "Meta";
  }
  if (e.ctrlKey && !e.metaKey && e.key === "Tab") return "Control";
  return null;
}

// ⌃1〜9 の番号（札の並びでの位置。9 は最後）。
function numberOf(bar: readonly string[], id: string): string | null {
  const at = bar.indexOf(id);
  if (at < 0) return null;
  if (at === bar.length - 1 && bar.length >= 9) return "9";
  return at < 8 ? String(at + 1) : null;
}

export function WorkspaceCycler() {
  const store = useStore();
  const { openWorkspace } = useWorkspace();
  const openRef = useRef(openWorkspace);
  openRef.current = openWorkspace;
  const phaseFor = useAtomValue(phaseForAtom);
  const bar = useAtomValue(barAtom);
  const [list, setList] = useState<Workspace[] | null>(null);
  const [at, setAt] = useState(0);
  const [shown, setShown] = useState(false);
  // キーの扱いは描画をまたぐので、控えで持つ。
  const live = useRef<{
    list: Workspace[];
    at: number;
    timer: number;
    hold: "Meta" | "Control";
  } | null>(null);

  useEffect(() => {
    const end = () => {
      if (live.current) window.clearTimeout(live.current.timer);
      live.current = null;
      setList(null);
      setShown(false);
    };
    const go = (ws: Workspace | undefined) => {
      end();
      if (ws && ws.id !== store.get(A.workspaceAtom)?.id) void openRef.current(ws);
    };
    const onDown = (e: KeyboardEvent) => {
      const cur = live.current;
      if (cur && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        end();
        return;
      }
      const hold = holdOf(e);
      if (!hold) return;
      e.preventDefault();
      e.stopPropagation();
      if (cur) {
        const n = cur.list.length;
        cur.at = (cur.at + (e.shiftKey ? n - 1 : 1)) % n;
        setAt(cur.at);
        return;
      }
      const known = store.get(A.workspacesAtom);
      const here = store.get(A.workspaceAtom);
      const order = cycleOrder(store.get(barAtom), store.get(visitedAtom), here?.id);
      const found = order
        .map((id) => (here?.id === id ? here : known.find((w) => w.id === id)))
        .filter((w): w is Workspace => !!w);
      if (found.length < 2) return;
      const start = e.shiftKey ? found.length - 1 : 1;
      live.current = {
        list: found,
        at: start,
        hold,
        timer: window.setTimeout(() => setShown(true), SHOW_AFTER_MS),
      };
      setList(found);
      setAt(start);
    };
    const onUp = (e: KeyboardEvent) => {
      const cur = live.current;
      if (cur && e.key === cur.hold) go(cur.list[cur.at]);
    };
    // ほかのアプリへ移ったら、⌃ を離したことが届かない。そのまま閉じる。
    const onBlur = () => end();
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", onBlur);
      end();
    };
  }, [store]);

  if (!list || !shown) return null;

  return (
    <div className="mg-ws-cycler fixed inset-0 z-50 flex items-center justify-center bg-black/25">
      <div
        role="listbox"
        aria-label="ワークスペース"
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--mg-border)] bg-[var(--mg-panel)] py-1.5 shadow-2xl"
      >
        {list.map((ws, i) => {
          const phase = phaseFor(ws);
          const num = numberOf(bar, ws.id);
          return (
            <div
              key={ws.id}
              role="option"
              aria-selected={i === at}
              onMouseDown={(e) => {
                e.preventDefault();
                if (live.current) window.clearTimeout(live.current.timer);
                live.current = null;
                setList(null);
                setShown(false);
                if (ws.id !== store.get(A.workspaceAtom)?.id) void openRef.current(ws);
              }}
              className={`mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 ${
                i === at ? "bg-[var(--mg-accent-soft)]" : "hover:bg-[var(--mg-hover)]"
              }`}
            >
              <span className="mg-ws-dot" style={{ background: colorVar(ws.color) }} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--mg-fg)]">
                {ws.name}
              </span>
              {phase && (
                <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-[var(--mg-muted)]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${phase === "working" ? "animate-pulse" : ""}`}
                    style={{ background: PHASE_COLOR[phase] }}
                  />
                  {PHASE_LABEL[phase]}
                </span>
              )}
              {num && (
                <kbd className="shrink-0 text-[10.5px] text-[var(--mg-muted)]">⌃{num}</kbd>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
