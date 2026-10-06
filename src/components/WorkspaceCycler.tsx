import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { PHASE_LABEL } from "../lib/claude";
import { keyedIn, movedIn } from "../lib/pointer";
import { colorVar, type Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { PHASE_COLOR, phaseForAtom } from "../state/claude";
import { barAtom, cyclerAskAtom, visitedAtom } from "../state/workspaceBar";

// ワークスペースの一覧。並べるのはツールバーの札と同じもので、最近開いた順。
// ⌘J は見るための一覧で、Enter かクリックで選ぶまで開いたまま。
// ⌃Tab はブラウザのタブ送りと同じく、⌃ を押したまま送って離したところで移る。
// すぐ離せば直前のワークスペースへ（一覧は出さない）。

// ⌃Tab を押してからこの間に離せば、一覧を出さずに移る（ちらつかせない）。
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

// 一覧を開く・送るキーなら、その修飾キーを返す。
function holdOf(e: KeyboardEvent): "Meta" | "Control" | null {
  if (e.altKey) return null;
  if (e.metaKey && !e.ctrlKey && (e.code === "KeyJ" || e.key.toLowerCase() === "j")) {
    return "Meta";
  }
  if (e.ctrlKey && !e.metaKey && e.key === "Tab") return "Control";
  return null;
}

export function WorkspaceCycler() {
  const store = useStore();
  const { openWorkspace } = useWorkspace();
  const openRef = useRef(openWorkspace);
  openRef.current = openWorkspace;
  const phaseFor = useAtomValue(phaseForAtom);
  const [list, setList] = useState<Workspace[] | null>(null);
  const [at, setAt] = useState(0);
  const [shown, setShown] = useState(false);
  const [picking, setPicking] = useState(false);
  // キーの扱いは描画をまたぐので、控えで持つ。
  // キーの扱いは描画をまたぐので、控えで持つ。
  // hold：⌃Tab。押したまま送り、⌃ を離したところで移る。
  // pick：⌘J。一覧を見るためのもの。Enter（かクリック）で選ぶまで開いたまま。
  const live = useRef<{
    list: Workspace[];
    at: number;
    timer: number;
    mode: "hold" | "pick";
  } | null>(null);

  const beginRef = useRef<() => void>(() => {});
  const ask = useAtomValue(cyclerAskAtom);
  useEffect(() => {
    if (ask > 0) beginRef.current();
  }, [ask]);

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
    const step = (by: 1 | -1) => {
      const cur = live.current;
      if (!cur) return;
      const n = cur.list.length;
      cur.at = (cur.at + by + n) % n;
      setAt(cur.at);
      keyedIn(document.querySelector<HTMLElement>(".mg-ws-cycler .mg-pick-list"));
    };
    const begin = (hold: "Meta" | "Control", back: boolean) => {
      const known = store.get(A.workspacesAtom);
      const here = store.get(A.workspaceAtom);
      const order = cycleOrder(store.get(barAtom), store.get(visitedAtom), here?.id);
      const found = order
        .map((id) => (here?.id === id ? here : known.find((w) => w.id === id)))
        .filter((w): w is Workspace => !!w);
      if (found.length < 2) return;
      const start = back ? found.length - 1 : 1;
      const mode = hold === "Meta" ? "pick" : "hold";
      live.current = {
        list: found,
        at: start,
        mode,
        timer: mode === "pick" ? 0 : window.setTimeout(() => setShown(true), SHOW_AFTER_MS),
      };
      setList(found);
      setAt(start);
      setPicking(mode === "pick");
      if (mode === "pick") setShown(true);
    };
    const onDown = (e: KeyboardEvent) => {
      const cur = live.current;
      const hold = holdOf(e);
      const claim = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (cur && e.key === "Escape") {
        claim();
        end();
        return;
      }
      if (cur?.mode === "pick") {
        if (hold === "Meta") {
          claim();
          end();
        } else if (e.key === "Enter") {
          claim();
          go(cur.list[cur.at]);
        } else if (e.key === "ArrowDown" || e.key === "Tab" || e.key.toLowerCase() === "j") {
          claim();
          step(e.shiftKey || e.key === "J" ? -1 : 1);
        } else if (e.key === "ArrowUp") {
          claim();
          step(-1);
        }
        return;
      }
      if (!hold) return;
      claim();
      if (cur) {
        step(e.shiftKey ? -1 : 1);
        return;
      }
      begin(hold, e.shiftKey);
    };
    beginRef.current = () => {
      if (!live.current) begin("Meta", false);
    };
    const onUp = (e: KeyboardEvent) => {
      const cur = live.current;
      if (cur?.mode === "hold" && e.key === "Control") go(cur.list[cur.at]);
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
    <div
      className="mg-ws-cycler fixed inset-0 z-50 flex items-center justify-center bg-black/25"
      onMouseDown={() => {
        if (live.current) window.clearTimeout(live.current.timer);
        live.current = null;
        setList(null);
        setShown(false);
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="mg-pick-list w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--mg-border)] bg-[var(--mg-panel)] py-1.5 shadow-2xl"
        role="listbox"
        aria-label="ワークスペース"
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
                e.stopPropagation();
                if (live.current) window.clearTimeout(live.current.timer);
                live.current = null;
                setList(null);
                setShown(false);
                if (ws.id !== store.get(A.workspaceAtom)?.id) void openRef.current(ws);
              }}
              data-on={i === at || undefined}
              className="mg-pick-row mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2"
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
            </div>
          );
        })}
        {picking && (
          <div className="mt-1 border-t border-[var(--mg-border)] px-4 pt-1.5 pb-0.5 text-right text-[10.5px] text-[var(--mg-muted)]">
            ⏎ 開く　↑↓ 選ぶ　esc 閉じる
          </div>
        )}
      </div>
    </div>
  );
}
