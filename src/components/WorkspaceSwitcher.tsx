import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { rootName } from "../lib/idb";
import { ago } from "../lib/when";
import { currentWindowLabel } from "../lib/windows";
import {
  colorVar,
  liveWorkspaces,
  rootsSummary,
  WORKSPACE_COLORS,
  type Workspace,
} from "../lib/workspaces";
import {
  foldersAtom,
  workspaceAtom,
  workspacesAtom,
  workspaceSwitcherOpenAtom,
} from "../state/atoms";
import { refreshWorkspaces } from "../state/workspace";
import { Icon } from "./Icon";

// ワークスペースを切り替える一覧（⌘⇧P）。最後に開いた順に並び、打てば絞り込む。
// Enter で今の窓を切り替え、⌘Enter で新しい窓に開く。別の窓で開いているものは
// その窓を前に出す。

const matches = (ws: Workspace, names: string[], q: string): boolean => {
  if (!q) return true;
  const hay = [ws.name, ...names].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
};

export function WorkspaceSwitcher() {
  const [open, setOpen] = useAtom(workspaceSwitcherOpenAtom);
  const list = useAtomValue(workspacesAtom);
  const current = useAtomValue(workspaceAtom);
  const folders = useAtomValue(foldersAtom);
  const store = useStore();
  const { openWorkspace } = useWorkspace();
  const ops = useWorkspaceOps();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // 別の窓で開いているもの（ID → 窓の名前）。
  const [elsewhere, setElsewhere] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [painting, setPainting] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ime = useImeSafeEnter();
  // 並べる時刻は開いたときに 1 度だけ決める。
  const now = useMemo(() => Date.now(), [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setEditing(null);
    setPainting(null);
    void refreshWorkspaces(store);
    const me = currentWindowLabel();
    void liveWorkspaces()
      .then((live) => setElsewhere(new Map(live.filter(([l]) => l !== me).map(([l, id]) => [id, l]))))
      .catch(() => setElsewhere(new Map()));
  }, [open, store]);

  const rows = useMemo(() => {
    // 今の窓で開いているものは、控えの一覧より新しい中身を持っている。
    const merged = current ? list.map((w) => (w.id === current.id ? current : w)) : list;
    return merged
      .map((ws) => ({ ws, names: ws.roots.map((r) => rootName(folders, r)) }))
      .filter(({ ws, names }) => matches(ws, names, query.trim()));
  }, [list, current, folders, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const close = () => setOpen(false);

  const choose = (i: number, newWindow: boolean) => {
    const row = rows[i];
    if (!row) return;
    close();
    if (newWindow) void ops.openInNewWindow(row.ws);
    else void openWorkspace(row.ws);
  };

  const askDelete = async (ws: Workspace) => {
    const ok = await confirm(
      `ワークスペース「${ws.name}」を消しますか？\nフォルダとファイルはそのまま残ります。`,
      { title: "ワークスペースを消す", kind: "warning" },
    );
    if (ok) await ops.deleteWorkspace(ws.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--mg-border)] bg-[var(--mg-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--mg-border)] px-4">
          <Icon name="workspaces" size={20} className="shrink-0 text-[var(--mg-accent)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyUp={ime.onKeyUp}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(active, e.metaKey);
              } else if (e.key === "Escape") {
                close();
              }
            }}
            placeholder="ワークスペースを切り替え…（名前・フォルダで絞り込み）"
            className="w-full bg-transparent py-3 text-[15px] outline-none placeholder:text-[var(--mg-muted)]"
          />
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {rows.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-[var(--mg-muted)]">
              {list.length === 0
                ? "ワークスペースはまだありません。フォルダを開くと、そのフォルダのワークスペースができます"
                : "一致するワークスペースがありません"}
            </div>
          )}
          {rows.map(({ ws, names }, i) => {
            const here = current?.id === ws.id;
            const other = elsewhere.get(ws.id);
            return (
              <div
                key={ws.id}
                data-idx={i}
                onMouseMove={() => setActive(i)}
                onClick={(e) => choose(i, e.metaKey)}
                className={`group relative flex cursor-pointer items-center gap-3 px-4 py-2 ${
                  i === active ? "bg-[var(--mg-accent-soft)]" : ""
                }`}
              >
                <button
                  title="色を変える"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPainting(painting === ws.id ? null : ws.id);
                  }}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-[var(--mg-hover)]"
                >
                  <span className="mg-ws-dot" style={{ background: colorVar(ws.color) }} />
                </button>
                <div className="min-w-0 flex-1">
                  {editing === ws.id ? (
                    <input
                      autoFocus
                      defaultValue={ws.name}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (ime.isComposing(e)) return;
                        if (e.key === "Enter") {
                          ops.renameWorkspace(ws.id, e.currentTarget.value);
                          setEditing(null);
                        } else if (e.key === "Escape") {
                          setEditing(null);
                        }
                      }}
                      onBlur={(e) => {
                        ops.renameWorkspace(ws.id, e.currentTarget.value);
                        setEditing(null);
                      }}
                      className="w-full rounded bg-[var(--mg-bg)] px-1 text-[13.5px] text-[var(--mg-fg)] outline-none ring-1 ring-[var(--mg-accent)]"
                    />
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13.5px] text-[var(--mg-fg)]">{ws.name}</span>
                      {here && (
                        <span className="shrink-0 rounded bg-[var(--mg-accent-soft)] px-1 text-[10px] font-medium text-[var(--mg-accent)]">
                          この窓
                        </span>
                      )}
                      {!here && other && (
                        <span className="shrink-0 rounded bg-[var(--mg-hover)] px-1 text-[10px] text-[var(--mg-muted)]">
                          別の窓
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 text-[11px] text-[var(--mg-muted)]">
                    <span className="truncate" title={ws.roots.join("\n")}>
                      {rootsSummary(names)}
                    </span>
                    {!here && ws.lastOpened > 0 && (
                      <span className="shrink-0">{ago(ws.lastOpened, now)}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button
                    title="名前を変える"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(ws.id);
                    }}
                    className="grid h-6 w-6 place-items-center rounded text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    title="新しい窓で開く (⌘⏎)"
                    onClick={(e) => {
                      e.stopPropagation();
                      choose(i, true);
                    }}
                    className="grid h-6 w-6 place-items-center rounded text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
                  >
                    <Icon name="open_in_new" size={15} />
                  </button>
                  {!here && (
                    <button
                      title="消す"
                      onClick={(e) => {
                        e.stopPropagation();
                        void askDelete(ws);
                      }}
                      className="grid h-6 w-6 place-items-center rounded text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-danger,#d9534f)]"
                    >
                      <Icon name="delete" size={15} />
                    </button>
                  )}
                </div>
                {painting === ws.id && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-10 top-full z-10 -mt-1 flex gap-1.5 rounded-lg border border-[var(--mg-border)] bg-[var(--mg-panel)] p-2 shadow-xl"
                  >
                    {WORKSPACE_COLORS.map((color) => (
                      <button
                        key={color}
                        title={color}
                        onClick={() => {
                          ops.recolorWorkspace(ws.id, color);
                          setPainting(null);
                        }}
                        className={`grid h-6 w-6 place-items-center rounded-full ${
                          color === ws.color ? "ring-2 ring-[var(--mg-fg)]" : ""
                        }`}
                      >
                        <span className="mg-ws-dot" style={{ background: colorVar(color) }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t border-[var(--mg-border)] px-2 py-1.5">
          <FootButton
            icon="add"
            label="新しく作る"
            onClick={() => {
              close();
              void ops.createWorkspace();
            }}
          />
          {current && (
            <FootButton
              icon="content_copy"
              label="今のタブで作る"
              onClick={() => {
                close();
                void ops.createWorkspace({ copy: true });
              }}
            />
          )}
          {current && (
            <FootButton
              icon="create_new_folder"
              label="フォルダを足す"
              onClick={() => {
                close();
                void ops.addRoot();
              }}
            />
          )}
          <span className="ml-auto px-2 text-[10.5px] text-[var(--mg-muted)]">
            ⏎ 切り替え　⌘⏎ 新しい窓
          </span>
        </div>
      </div>
    </div>
  );
}

function FootButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
    >
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
}
