import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL } from "../lib/claude";
import { currentWindowLabel } from "../lib/windows";
import { colorVar, liveWorkspaces, WORKSPACE_COLORS, type Workspace } from "../lib/workspaces";
import { workspaceAtom, workspacesAtom } from "../state/atoms";
import { PHASE_COLOR, phaseForAtom } from "../state/claude";
import { barAtom, moveInBar, removeFromBar } from "../state/workspaceBar";
import { FolderChooser } from "./FolderChooser";
import { Icon } from "./Icon";

// ワークスペースの列。タブの上に横一列で並べ、1 回押せば切り替わる。
// 開いたものが末尾に入り、× で列から外す（ワークスペースは消さない）。
// 掴んで並べ替えられる（⌃1〜9 はこの並びの位置を指す）。

const DRAG_TYPE = "application/x-fude-ws";

interface Menu {
  ws: Workspace;
  x: number;
  y: number;
}

export function WorkspaceBar() {
  const [bar, setBar] = useAtom(barAtom);
  const list = useAtomValue(workspacesAtom);
  const current = useAtomValue(workspaceAtom);
  const phaseFor = useAtomValue(phaseForAtom);
  const { openWorkspace } = useWorkspace();
  const ops = useWorkspaceOps();
  const ime = useImeSafeEnter();
  // 別のウィンドウで開いているもの。押すとそのウィンドウが前に出る。
  const [elsewhere, setElsewhere] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [making, setMaking] = useState<{ left: number; top: number } | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const here = useRef<HTMLDivElement>(null);

  // 並べるもの。今開いているものは控えより新しい中身を持っている。
  const items = useMemo(() => {
    const byId = new Map(list.map((w) => [w.id, w]));
    if (current) byId.set(current.id, current);
    return bar.flatMap((id) => {
      const ws = byId.get(id);
      return ws ? [ws] : [];
    });
  }, [bar, list, current]);

  useEffect(() => {
    const me = currentWindowLabel();
    const read = () =>
      void liveWorkspaces()
        .then((live) => setElsewhere(new Set(live.filter(([l]) => l !== me).map(([, id]) => id))))
        .catch(() => setElsewhere(new Set()));
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [bar, current?.id]);

  // 今いるものを見える位置へ寄せる。
  useEffect(() => {
    here.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current?.id, items.length]);

  // メニューと作る一覧は、外を押すか Esc で閉じる。
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (items.length === 0 && !current) return null;

  const askDelete = async (ws: Workspace) => {
    const ok = await confirm(
      `ワークスペース「${ws.name}」を消しますか？\nフォルダとファイルはそのまま残ります。`,
      { title: "ワークスペースを消す", kind: "warning" },
    );
    if (ok) await ops.deleteWorkspace(ws.id);
  };

  // 差し込み位置は各項目の矩形から決める（タブの並べ替えと同じ）。
  const indexAt = (e: React.DragEvent<HTMLDivElement>): number => {
    const cells = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-ws]"));
    for (let i = 0; i < cells.length; i++) {
      const box = cells[i].getBoundingClientRect();
      if (e.clientX < box.left + box.width / 2) return i;
    }
    return cells.length;
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="ワークスペース"
        className="mg-ws-bar flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-[var(--mg-border)] bg-[var(--mg-panel)]"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropAt(indexAt(e));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DRAG_TYPE);
          const at = dropAt;
          setDropAt(null);
          if (!id || at === null) return;
          e.preventDefault();
          setBar((was) => moveInBar(was, id, at));
        }}
      >
        {items.map((ws, i) => {
          const on = ws.id === current?.id;
          const away = !on && elsewhere.has(ws.id);
          const phase = phaseFor(ws);
          return (
            <div
              key={ws.id}
              data-ws={ws.id}
              ref={on ? here : undefined}
              role="tab"
              aria-selected={on}
              draggable={renaming !== ws.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, ws.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => {
                if (!on) void openWorkspace(ws);
              }}
              onDoubleClick={() => setRenaming(ws.id)}
              onAuxClick={(e) => {
                if (e.button === 1) setBar((was) => removeFromBar(was, ws.id));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ ws, x: e.clientX, y: e.clientY });
              }}
              title={
                away
                  ? `${ws.name}（別のウィンドウで開いています）`
                  : i < 9
                    ? `${ws.name}（⌃${i + 1}）`
                    : ws.name
              }
              className={`group relative flex max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-[var(--mg-border)] pl-3 pr-1.5 text-[12px] ${
                on
                  ? "bg-[var(--mg-bg)] text-[var(--mg-fg)]"
                  : `hover:bg-[var(--mg-hover)] ${away ? "text-[var(--mg-muted)] opacity-70" : "text-[var(--mg-fg-dim)]"}`
              }`}
            >
              {on && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--mg-accent)]" />}
              <span className="mg-ws-dot" style={{ background: colorVar(ws.color) }} />
              {renaming === ws.id ? (
                <input
                  autoFocus
                  defaultValue={ws.name}
                  onClick={(e) => e.stopPropagation()}
                  onKeyUp={ime.onKeyUp}
                  onCompositionStart={ime.onCompositionStart}
                  onCompositionEnd={ime.onCompositionEnd}
                  onKeyDown={(e) => {
                    if (ime.isComposing(e)) return;
                    if (e.key === "Enter") {
                      ops.renameWorkspace(ws.id, e.currentTarget.value);
                      setRenaming(null);
                    } else if (e.key === "Escape") {
                      setRenaming(null);
                    }
                  }}
                  onBlur={(e) => {
                    ops.renameWorkspace(ws.id, e.currentTarget.value);
                    setRenaming(null);
                  }}
                  className="w-32 rounded bg-[var(--mg-bg)] px-1 text-[12px] text-[var(--mg-fg)] outline-none ring-1 ring-[var(--mg-accent)]"
                />
              ) : (
                <span className="truncate">{ws.name}</span>
              )}
              {phase && (
                <span
                  title={`Claude のセッション：${PHASE_LABEL[phase]}`}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${phase === "working" ? "animate-pulse" : ""}`}
                  style={{ background: PHASE_COLOR[phase] }}
                />
              )}
              <button
                type="button"
                title="列から外す（ワークスペースは残ります）"
                onClick={(e) => {
                  e.stopPropagation();
                  setBar((was) => removeFromBar(was, ws.id));
                }}
                className={`mg-tab-x ${on ? "" : "opacity-0 group-hover:opacity-100"}`}
              >
                <Icon name="close" size={13} />
              </button>
              {dropAt === i && <Marker side="left" />}
              {dropAt === i + 1 && i === items.length - 1 && <Marker side="right" />}
            </div>
          );
        })}
        <button
          type="button"
          title="新しいワークスペース"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setMaking(
              making
                ? null
                : { left: Math.min(box.left, window.innerWidth - 470), top: box.bottom + 4 },
            );
          }}
          className="grid w-8 shrink-0 place-items-center text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name="add" size={16} />
        </button>
      </div>

      {menu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ left: Math.min(menu.x, window.innerWidth - 220), top: menu.y + 2 }}
          className="fixed z-50 w-[210px] rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1 text-[12.5px] shadow-2xl"
        >
          <MenuItem
            icon="edit"
            label="名前を変える"
            onClick={() => {
              setRenaming(menu.ws.id);
              setMenu(null);
            }}
          />
          <div className="flex flex-wrap gap-1 px-2 py-1.5">
            {WORKSPACE_COLORS.map((color) => (
              <button
                key={color}
                title={color}
                onClick={() => {
                  ops.recolorWorkspace(menu.ws.id, color);
                  setMenu(null);
                }}
                className={`grid h-5 w-5 place-items-center rounded-full ${
                  color === menu.ws.color ? "ring-2 ring-[var(--mg-fg)]" : ""
                }`}
              >
                <span className="mg-ws-dot" style={{ background: colorVar(color) }} />
              </button>
            ))}
          </div>
          <MenuItem
            icon="open_in_new"
            label="新しいウィンドウで開く"
            onClick={() => {
              void ops.openInNewWindow(menu.ws);
              setMenu(null);
            }}
          />
          <MenuItem
            icon="close"
            label="列から外す"
            onClick={() => {
              setBar((was) => removeFromBar(was, menu.ws.id));
              setMenu(null);
            }}
          />
          {menu.ws.id !== current?.id && (
            <MenuItem
              icon="delete"
              label="消す"
              onClick={() => {
                const ws = menu.ws;
                setMenu(null);
                void askDelete(ws);
              }}
            />
          )}
        </div>
      )}

      {making && (
        <>
          {/* 外を押したら閉じる。画面は暗くしない。 */}
          <div className="fixed inset-0 z-40" onClick={() => setMaking(null)} />
          <div
            style={{ left: Math.max(8, making.left), top: making.top }}
            className="fixed z-50 w-[460px] overflow-hidden rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] shadow-2xl"
          >
            <FolderChooser
              mode="create"
              initial={current?.roots ?? []}
              hidden={[]}
              pickOther={ops.pickOtherFolder}
              onBack={() => setMaking(null)}
              onDone={(roots, name, newWindow) => {
                setMaking(null);
                void ops.createWorkspace({ roots, name, newWindow });
              }}
            />
            {current && (
              <button
                onClick={() => {
                  setMaking(null);
                  void ops.createWorkspace({ copy: true });
                }}
                className="flex w-full items-center gap-2 border-t border-[var(--mg-border)] px-4 py-2 text-left text-[12px] text-[var(--mg-fg-dim)] hover:bg-[var(--mg-hover)]"
              >
                <Icon name="content_copy" size={15} />
                今のタブで作る
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[var(--mg-fg)] hover:bg-[var(--mg-hover)]"
    >
      <Icon name={icon} size={15} className="text-[var(--mg-muted)]" />
      {label}
    </button>
  );
}

function Marker({ side }: { side: "left" | "right" }) {
  return (
    <span
      className={`pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--mg-accent)] ${
        side === "left" ? "left-0" : "right-0"
      }`}
    />
  );
}
