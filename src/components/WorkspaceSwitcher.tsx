import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL } from "../lib/claude";
import { folderDisplayName, rootName } from "../lib/idb";
import { ago } from "../lib/when";
import { currentWindowLabel } from "../lib/windows";
import { colorVar, liveWorkspaces, rootsSummary, type Workspace } from "../lib/workspaces";
import {
  foldersAtom,
  workspaceAtom,
  workspaceMenuAtom,
  workspacesAtom,
  workspaceSwitcherOpenAtom,
} from "../state/atoms";
import { PHASE_COLOR, phaseForAtom } from "../state/claude";
import { refreshWorkspaces } from "../state/workspace";
import { Icon } from "./Icon";

// ワークスペースを探して開く一覧（⌘⇧P）。札の列に出していないものや、まだ
// ワークスペースになっていないフォルダもここから開ける。役目は探して開くこと
// だけ（作るのは札の並びの ＋、手入れは右押しのメニュー）。
// Enter で今のウィンドウを切り替え、⌘Enter で新しいウィンドウに開く。

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
  const phaseFor = useAtomValue(phaseForAtom);
  const openMenu = useSetAtom(workspaceMenuAtom);
  const store = useStore();
  const { openWorkspace, openFolder, openFolderInNewWindow } = useWorkspace();
  const ops = useWorkspaceOps();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // 別のウィンドウで開いているもの（ID → ウィンドウの名前）。
  const [elsewhere, setElsewhere] = useState<Map<string, string>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const ime = useImeSafeEnter();
  // 並べる時刻は開いたときに 1 度だけ決める。
  const now = useMemo(() => Date.now(), [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    void refreshWorkspaces(store);
    const me = currentWindowLabel();
    void liveWorkspaces()
      .then((live) => setElsewhere(new Map(live.filter(([l]) => l !== me).map(([l, id]) => [id, l]))))
      .catch(() => setElsewhere(new Map()));
  }, [open, store]);

  const rows = useMemo(() => {
    // 控えをまだ書き終えていなくても、今開いているものは必ず並べる。
    const merged = current
      ? list.some((w) => w.id === current.id)
        ? list.map((w) => (w.id === current.id ? current : w))
        : [current, ...list]
      : list;
    return merged
      .map((ws) => ({ ws, names: ws.roots.map((r) => rootName(folders, r)) }))
      .filter(({ ws, names }) => matches(ws, names, query.trim()));
  }, [list, current, folders, query]);

  // 開いたことはあるが、まだワークスペースになっていないフォルダ。選ぶとその
  // フォルダのワークスペースができる。
  const loose = useMemo(() => {
    const owned = new Set(
      [...list, ...(current ? [current] : [])].flatMap((w) => (w.folder ? [w.folder] : [])),
    );
    const q = query.trim().toLowerCase();
    return [...folders]
      .filter((f) => !owned.has(f.path))
      .filter((f) => {
        if (!q) return true;
        const hay = `${folderDisplayName(f)} ${f.path}`.toLowerCase();
        return q.split(/\s+/).every((word) => hay.includes(word));
      })
      .sort((a, b) => b.lastOpened - a.lastOpened);
  }, [folders, list, current, query]);
  const total = rows.length + loose.length;

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
    if (row) {
      close();
      if (newWindow) void ops.openInNewWindow(row.ws);
      else void openWorkspace(row.ws);
      return;
    }
    const folder = loose[i - rows.length];
    if (!folder) return;
    close();
    if (newWindow) void openFolderInNewWindow(folder.path, folderDisplayName(folder));
    else void openFolder(folder.path);
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
                setActive((a) => Math.min(a + 1, total - 1));
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
            placeholder="ワークスペースを探して開く…（名前・フォルダで絞り込み）"
            className="w-full bg-transparent py-3 text-[15px] outline-none placeholder:text-[var(--mg-muted)]"
          />
        </div>

        <div ref={listRef} className="max-h-[56vh] overflow-y-auto py-1">
          {total === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-[var(--mg-muted)]">
              {list.length === 0 && folders.length === 0
                ? "まだ何もありません。フォルダを開くと、そのフォルダのワークスペースができます"
                : "一致するものがありません"}
            </div>
          )}
          {rows.map(({ ws, names }, i) => {
            const here = current?.id === ws.id;
            const other = elsewhere.get(ws.id);
            const phase = phaseFor(ws);
            return (
              <div
                key={ws.id}
                data-idx={i}
                onMouseMove={() => setActive(i)}
                onClick={(e) => choose(i, e.metaKey)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu({ id: ws.id, x: e.clientX, y: e.clientY });
                }}
                className={`flex cursor-pointer items-center gap-3 px-4 py-2 ${
                  i === active ? "bg-[var(--mg-accent-soft)]" : ""
                }`}
              >
                <span className="mg-ws-dot" style={{ background: colorVar(ws.color) }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[13.5px] text-[var(--mg-fg)]">{ws.name}</span>
                    {here && (
                      <span className="shrink-0 rounded bg-[var(--mg-accent-soft)] px-1 text-[10px] font-medium text-[var(--mg-accent)]">
                        このウィンドウ
                      </span>
                    )}
                    {!here && other && (
                      <span className="shrink-0 rounded bg-[var(--mg-hover)] px-1 text-[10px] text-[var(--mg-muted)]">
                        別のウィンドウ
                      </span>
                    )}
                    {phase && (
                      <span
                        className="flex shrink-0 items-center gap-1 text-[10.5px] text-[var(--mg-muted)]"
                        title={`Claude のセッション：${PHASE_LABEL[phase]}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${phase === "working" ? "animate-pulse" : ""}`}
                          style={{ background: PHASE_COLOR[phase] }}
                        />
                        {PHASE_LABEL[phase]}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 text-[11px] text-[var(--mg-muted)]">
                    <span className="truncate" title={ws.roots.join("\n")}>
                      {rootsSummary(names)}
                    </span>
                    {!here && ws.lastOpened > 0 && (
                      <span className="shrink-0">{ago(ws.lastOpened, now)}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {loose.length > 0 && (
            <div className="mt-1 border-t border-[var(--mg-border)] pt-1">
              <div className="px-4 py-1 text-[10.5px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
                フォルダ
              </div>
              {loose.map((f, j) => {
                const i = rows.length + j;
                return (
                  <div
                    key={f.path}
                    data-idx={i}
                    onMouseMove={() => setActive(i)}
                    onClick={(e) => choose(i, e.metaKey)}
                    title="開くと、このフォルダのワークスペースができます"
                    className={`flex cursor-pointer items-center gap-3 px-4 py-1.5 ${
                      i === active ? "bg-[var(--mg-accent-soft)]" : ""
                    }`}
                  >
                    <Icon name="folder" size={16} className="shrink-0 text-[var(--mg-muted)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-[var(--mg-fg)]">
                        {folderDisplayName(f)}
                      </div>
                      <div className="truncate text-[11px] text-[var(--mg-muted)]" title={f.path}>
                        {f.path}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10.5px] text-[var(--mg-muted)]">
                      {ago(f.lastOpened, now)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center border-t border-[var(--mg-border)] px-4 py-1.5 text-[10.5px] text-[var(--mg-muted)]">
          <span>右クリックで名前・色・フォルダを変更</span>
          <span className="ml-auto">⏎ 開く　⌘⏎ 新しいウィンドウ</span>
        </div>
      </div>
    </div>
  );
}
