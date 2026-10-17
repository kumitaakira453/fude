import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL } from "../lib/claude";
import { pathExists } from "../lib/fsAccess";
import { ago } from "../lib/when";
import { markInTree } from "../lib/ui";
import { wroteTree, type WroteNode } from "../lib/wroteTree";
import { currentWindowLabel } from "../lib/windows";
import { bindWindow } from "../lib/workspaces";
import {
  activeFolderIdAtom,
  claudeFilesViewAtom,
  filesAtom,
  layoutOwnerAtom,
  pathLabelAtom,
  workspaceAtom,
} from "../state/atoms";
import { dropWorkspaceSave } from "../state/workspace";
import { phaseForAtom, seenTab } from "../state/claude";
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

// fill：Claude の面に出すときは欄の高さいっぱいに並べる。ファイルの面の下に
// 添えるときは、木を押し出さないよう高さを抑える。
export function ClaudeFiles({ fill = false }: { fill?: boolean }) {
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
  // 書いた後に移した・消したファイル。並びには残し、淡く出して押せなくする
  // （古い道筋のまま押すと、無いファイルを開くことになる）。確かめ直すのは、
  // 書いたものが増えたときと、木が組み直されたとき（移動・削除を拾ったとき）。
  const files = useAtomValue(filesAtom);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let alive = true;
    const paths = view === "list" ? wrote.slice(0, SHOWN).map((w) => w.path) : wrote.map((w) => w.path);
    void Promise.all(paths.map(async (p) => [p, await pathExists(p)] as const)).then((seen) => {
      if (alive) setGone(new Set(seen.filter(([, there]) => !there).map(([p]) => p)));
    });
    return () => {
      alive = false;
    };
  }, [wrote, files, view]);
  if (!ws?.claude) return null;

  const show = (path: string) => {
    if (gone.has(path)) return;
    openFile(path);
    markInTree(store, path);
    seenTab(store, path);
  };
  // ファイルの行の見た目。無いものは淡く出し、押せないことと理由を添える。
  // disabled にすると指したときの吹き出しが出ないので、押しても何もしない形で止める。
  const rowFace = (path: string) =>
    gone.has(path)
      ? {
          className: "mg-sess-row is-gone",
          "aria-disabled": true,
          "data-tip": "移動または削除されています",
        }
      : { className: "mg-sess-row", title: path };
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
          {...rowFace(n.path)}
          onClick={() => show(n.path)}
          style={{ paddingLeft: 18 + depth * 14 }}
        >
          <span className="mg-sess-name">{n.name}</span>
          <span className="mg-sess-time">{ago(n.at, now)}</span>
        </button>
      ),
    );

  return (
    <div className={`mg-sess${fill ? " is-fill" : ""}`}>
      <div className="mg-sess-head">
        <button
          onClick={() => setOpen((v) => !v)}
          data-tip={open ? "このセッションで作成・編集したファイル（押すと畳む）" : "このセッションで作成・編集したファイル（押すと開く）"}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <Icon name="claude" size={12} stroke={1.8} />
          <span className="min-w-0 truncate">セッションのファイル</span>
        </button>
        <button
          onClick={() => setView(view === "tree" ? "list" : "tree")}
          data-tip={view === "tree" ? "一覧で表示" : "ツリーで表示"}
          aria-label={view === "tree" ? "一覧で表示" : "ツリーで表示"}
          className="mg-claude-view grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name={view === "tree" ? "format_list_bulleted" : "account_tree"} size={12} />
        </button>
        {phase && (
          <span className={`mg-ws-pill-badge is-${phase}`}>{PHASE_LABEL[phase]}</span>
        )}
      </div>
      {open && (
        <div className={fill ? "min-h-0 flex-1 overflow-y-auto" : "max-h-[38vh] overflow-y-auto"}>
          {wrote.length === 0 && (
            <div className="mg-sess-row text-[var(--mg-muted)]" style={{ paddingLeft: 18 }}>
              まだありません
            </div>
          )}
          {view === "tree" && <div className="mg-claude-tree">{drawTree(tree, 0)}</div>}
          {view === "list" &&
            wrote.slice(0, SHOWN).map((w) => (
              <button
                key={w.path}
                {...rowFace(w.path)}
                onClick={() => show(w.path)}
                style={{ paddingLeft: 18 }}
              >
                <span className="mg-sess-name">
                  {w.path.split("/").pop()}
                  <span className="ml-1.5 text-[10.5px] text-[var(--mg-muted)]">
                    {label(w.path).split("/").slice(0, -1).join("/")}
                  </span>
                </span>
                <span className="mg-sess-time">{ago(w.at, now)}</span>
              </button>
            ))}
          {view === "list" && wrote.length > SHOWN && (
            <div className="mg-sess-row text-[var(--mg-muted)]" style={{ paddingLeft: 18 }}>
              ほか {wrote.length - SHOWN} 件
            </div>
          )}
        </div>
      )}
    </div>
  );
}
