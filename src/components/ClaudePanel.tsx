import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useMemo, useState, type ReactNode } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL } from "../lib/claude";
import { ago } from "../lib/when";
import { markInTree } from "../lib/ui";
import { wroteTree, type WroteNode } from "../lib/wroteTree";
import { currentWindowLabel } from "../lib/windows";
import { bindWindow } from "../lib/workspaces";
import {
  activeFolderIdAtom,
  claudeFilesViewAtom,
  layoutOwnerAtom,
  pathLabelAtom,
  workspaceAtom,
} from "../state/atoms";
import { dropWorkspaceSave } from "../state/workspace";
import { PHASE_COLOR, phaseForAtom, seenTab } from "../state/claude";
import { ClaudeMark } from "./ClaudeMark";
import { Icon } from "./Icon";

// Claude のセッションに結びついたワークスペースの、サイドバーの欄（ベータ）。
// セッションの状態と、そのセッションが書いたファイルを新しい順（またはフォルダごと）に並べる。
// セッションが消されたら、その旨と後始末の口を出す。

// 欄に並べる数。それより古いものは「ほか N 件」にまとめる。
const SHOWN = 30;

export function ClaudeBanner() {
  const ws = useAtomValue(workspaceAtom);
  const phase = useAtomValue(phaseForAtom)(ws);
  const ops = useWorkspaceOps();
  const store = useStore();
  if (!ws?.claude || (phase !== "deleted" && phase !== "unknown")) return null;

  if (phase === "unknown") {
    return (
      <div className="mx-2 mt-2 rounded-lg bg-[var(--mg-hover)] px-2.5 py-2 text-[11.5px] text-[var(--mg-muted)]">
        Claude のセッションを読み込めません。最後に確認できた状態を表示しています
      </div>
    );
  }

  const dropAll = async () => {
    const ok = await confirm(
      `ワークスペース「${ws.name}」も削除しますか？\nフォルダとファイルは削除されません。`,
      { title: "ワークスペースの削除", kind: "warning" },
    );
    if (!ok) return;
    // 開いているものは消せないので、窓をスタート画面へ戻してから消す。
    dropWorkspaceSave(ws.id);
    await bindWindow(currentWindowLabel(), null).catch(() => {});
    store.set(layoutOwnerAtom, null);
    store.set(workspaceAtom, null);
    store.set(activeFolderIdAtom, null);
    await ops.deleteWorkspace(ws.id);
  };

  return (
    <div className="mx-2 mt-2 rounded-lg border border-[var(--mg-border)] px-2.5 py-2 text-[11.5px]">
      <div className="flex items-center gap-1.5 font-medium text-[var(--mg-fg)]">
        <Icon name="link_off" size={15} className="text-[var(--mg-muted)]" />
        Claude のセッションは削除されています
      </div>
      <div className="mt-1 text-[var(--mg-muted)]">
        タブとファイルの一覧は残っています
      </div>
      <div className="mt-1.5 flex gap-1">
        <button
          onClick={() => ops.unlinkSession(ws.id)}
          className="rounded-md bg-[var(--mg-accent-soft)] px-2 py-1 text-[var(--mg-accent)] hover:opacity-80"
        >
          連携を解除して残す
        </button>
        <button
          onClick={() => void dropAll()}
          className="rounded-md px-2 py-1 text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          ワークスペースも削除
        </button>
      </div>
    </div>
  );
}

export function ClaudeFiles() {
  const ws = useAtomValue(workspaceAtom);
  const phase = useAtomValue(phaseForAtom)(ws);
  const label = useAtomValue(pathLabelAtom);
  const [view, setView] = useAtom(claudeFilesViewAtom);
  const { openFile } = useWorkspace();
  const store = useStore();
  const [open, setOpen] = useState(true);
  // 木で畳んだフォルダ（最初はすべて開いておく）。
  const [shut, setShut] = useState<Set<string>>(new Set());
  const now = useMemo(() => Date.now(), [ws?.claude?.wrote]);
  const wrote = ws?.claude?.wrote ?? [];
  const tree = useMemo(
    () => (view === "tree" ? wroteTree(wrote, label) : []),
    [view, wrote, label],
  );
  if (!ws?.claude) return null;

  const show = (path: string) => {
    openFile(path);
    markInTree(store, path);
    seenTab(store, path);
  };
  const toggle = (key: string) =>
    setShut((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const drawTree = (nodes: WroteNode[], depth: number): ReactNode[] =>
    nodes.map((n) =>
      n.kind === "dir" ? (
        <div key={`d:${n.key}`}>
          <button
            onClick={() => toggle(n.key)}
            title={n.key}
            style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}
            className="flex w-full items-center gap-1 rounded-md py-0.5 pr-3 text-left text-[12px] text-[var(--mg-fg-dim)] hover:bg-[var(--mg-hover)]"
          >
            <Icon
              name="chevron_right"
              size={15}
              className={`shrink-0 text-[var(--mg-muted)] transition-transform ${shut.has(n.key) ? "" : "rotate-90"}`}
            />
            <Icon name="folder" size={14} className="shrink-0 text-[var(--mg-muted)]" />
            <span className="min-w-0 truncate">{n.name}</span>
          </button>
          {!shut.has(n.key) && drawTree(n.children, depth + 1)}
        </div>
      ) : (
        <button
          key={`f:${n.path}`}
          title={n.path}
          onClick={() => show(n.path)}
          style={{ paddingLeft: `${1.45 + depth * 0.85}rem` }}
          className="flex w-full items-baseline gap-2 rounded-md py-0.5 pr-3 text-left hover:bg-[var(--mg-hover)]"
        >
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--mg-fg)]">{n.name}</span>
          <span className="shrink-0 text-[10.5px] text-[var(--mg-muted)]">{ago(n.at, now)}</span>
        </button>
      ),
    );

  return (
    <div className="border-t border-[var(--mg-border)] px-1 pt-1">
      <div className="flex items-center whitespace-nowrap text-[11px] font-medium text-[var(--mg-muted)]">
        <button
          onClick={() => setOpen((v) => !v)}
          title="このセッションで作成・編集したファイル"
          className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-left"
        >
          <Icon
            name="chevron_right"
            size={16}
            className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <ClaudeMark size={12} className="mr-0.5" />
          <span className="min-w-0 truncate">セッションのファイル</span>
        </button>
        <button
          onClick={() => setView(view === "tree" ? "list" : "tree")}
          title={view === "tree" ? "一覧で表示" : "ツリーで表示"}
          aria-label={view === "tree" ? "一覧で表示" : "ツリーで表示"}
          className="mg-claude-view grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name={view === "tree" ? "format_list_bulleted" : "account_tree"} size={14} />
        </button>
        {phase && (
          <span className="flex shrink-0 items-center gap-1 pl-1.5 pr-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${phase === "working" ? "animate-pulse" : ""}`}
              style={{ background: PHASE_COLOR[phase] }}
            />
            {PHASE_LABEL[phase]}
          </span>
        )}
      </div>
      {open && (
        <div className="max-h-[38vh] overflow-y-auto pb-2">
          {wrote.length === 0 && (
            <div className="px-3 py-2 text-[11.5px] text-[var(--mg-muted)]">
              まだありません
            </div>
          )}
          {view === "tree" && <div className="mg-claude-tree">{drawTree(tree, 0)}</div>}
          {view === "list" &&
            wrote.slice(0, SHOWN).map((w) => (
              <button
                key={w.path}
                title={w.path}
                onClick={() => show(w.path)}
                className="flex w-full items-baseline gap-2 rounded-md px-3 py-1 text-left hover:bg-[var(--mg-hover)]"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--mg-fg)]">
                  {w.path.split("/").pop()}
                  <span className="ml-1.5 text-[10.5px] text-[var(--mg-muted)]">
                    {label(w.path).split("/").slice(0, -1).join("/")}
                  </span>
                </span>
                <span className="shrink-0 text-[10.5px] text-[var(--mg-muted)]">{ago(w.at, now)}</span>
              </button>
            ))}
          {view === "list" && wrote.length > SHOWN && (
            <div className="px-3 py-1 text-[11px] text-[var(--mg-muted)]">
              ほか {wrote.length - SHOWN} 件
            </div>
          )}
        </div>
      )}
    </div>
  );
}
