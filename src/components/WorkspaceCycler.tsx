import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { PHASE_LABEL } from "../lib/claude";
import { movedIn } from "../lib/pointer";
import type { Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { PHASE_COLOR, phaseForAtom } from "../state/claude";
import { WorkspaceChip } from "./WorkspaceChip";
import { barAtom, visitedAtom } from "../state/workspaceBar";

// ⌃Tab の一覧。ブラウザのタブ送りと同じく、⌃ を押したまま Tab で送り、離した
// ところで移る。すぐ離せば直前のワークスペースへ（一覧は出さない）。並べるのは
// ツールバーの札と同じもので、最近開いた順。見て選ぶ一覧は ⌘J（WorkspaceSwitcher）。

// 押してからこの間に離せば、一覧を出さずに移る（ちらつかせない）。
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

const isStep = (e: KeyboardEvent) => e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab";

export function WorkspaceCycler() {
  const store = useStore();
  const { openWorkspace } = useWorkspace();
  const openRef = useRef(openWorkspace);
  openRef.current = openWorkspace;
  const phaseFor = useAtomValue(phaseForAtom);
  const [list, setList] = useState<Workspace[] | null>(null);
  const [at, setAt] = useState(0);
  const [shown, setShown] = useState(false);
  // キーの扱いは描画をまたぐので、控えで持つ。
  const live = useRef<{ list: Workspace[]; at: number; timer: number } | null>(null);

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
  const goRef = useRef(go);
  goRef.current = go;
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const cur = live.current;
      if (cur && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        endRef.current();
        return;
      }
      if (!isStep(e)) return;
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
        timer: window.setTimeout(() => setShown(true), SHOW_AFTER_MS),
      };
      setList(found);
      setAt(start);
    };
    const onUp = (e: KeyboardEvent) => {
      const cur = live.current;
      if (cur && e.key === "Control") goRef.current(cur.list[cur.at]);
    };
    // ほかのアプリへ移ったら、⌃ を離したことが届かない。そのまま閉じる。
    const onBlur = () => endRef.current();
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", onBlur);
      endRef.current();
    };
  }, [store]);

  if (!list || !shown) return null;

  return (
    <div className="mg-ws-cycler mg-scrim" onMouseDown={() => end()}>
      <div
        role="listbox"
        aria-label="ワークスペース"
        onMouseDown={(e) => e.stopPropagation()}
        className="mg-pick-list mg-pop mg-cycler-box"
      >
        {list.map((ws, i) => {
          const phase = phaseFor(ws);
          return (
            <div
              key={ws.id}
              role="option"
              aria-selected={i === at}
              onMouseMove={(e) => {
                const cur = live.current;
                if (!movedIn(e) || !cur || cur.at === i) return;
                cur.at = i;
                setAt(i);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                go(ws);
              }}
              data-on={i === at || undefined}
              className="mg-pick-row mg-cycler-row"
            >
              <WorkspaceChip ws={ws} />
              <span className="min-w-0 flex-1 truncate">{ws.name}</span>
              {phase && (
                <span className="mg-cycler-phase">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${phase === "working" ? "animate-pulse" : ""}`}
                    style={{ background: PHASE_COLOR[phase] }}
                  />
                  {PHASE_LABEL[phase]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
