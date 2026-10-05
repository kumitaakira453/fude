import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtomValue, useStore } from "jotai";
import { useMemo, useState } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL } from "../lib/claude";
import { ago } from "../lib/when";
import { markInTree } from "../lib/ui";
import { currentWindowLabel } from "../lib/windows";
import { bindWindow } from "../lib/workspaces";
import {
  activeFolderIdAtom,
  layoutOwnerAtom,
  pathLabelAtom,
  workspaceAtom,
} from "../state/atoms";
import { dropWorkspaceSave } from "../state/workspace";
import { PHASE_COLOR, phaseForAtom, seenTab } from "../state/claude";
import { ClaudeMark } from "./ClaudeMark";
import { Icon } from "./Icon";

// Claude のセッションに結びついたワークスペースの、サイドバーの欄（ベータ）。
// セッションの状態と、そのセッションが書いたファイルを新しい順に並べる。
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
        Claude のセッションを読めません。最後に分かっていた状態のまま出しています
      </div>
    );
  }

  const dropAll = async () => {
    const ok = await confirm(
      `ワークスペース「${ws.name}」も消しますか？\nフォルダとファイルはそのまま残ります。`,
      { title: "ワークスペースを消す", kind: "warning" },
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
        Claude のセッションは削除されました
      </div>
      <div className="mt-1 text-[var(--mg-muted)]">
        タブと書いたファイルの一覧はこのまま残っています
      </div>
      <div className="mt-1.5 flex gap-1">
        <button
          onClick={() => ops.unlinkSession(ws.id)}
          className="rounded-md bg-[var(--mg-accent-soft)] px-2 py-1 text-[var(--mg-accent)] hover:opacity-80"
        >
          ふつうのワークスペースにする
        </button>
        <button
          onClick={() => void dropAll()}
          className="rounded-md px-2 py-1 text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          ワークスペースも消す
        </button>
      </div>
    </div>
  );
}

export function ClaudeFiles() {
  const ws = useAtomValue(workspaceAtom);
  const phase = useAtomValue(phaseForAtom)(ws);
  const label = useAtomValue(pathLabelAtom);
  const { openFile } = useWorkspace();
  const store = useStore();
  const [open, setOpen] = useState(true);
  const now = useMemo(() => Date.now(), [ws?.claude?.wrote]);
  const wrote = ws?.claude?.wrote ?? [];
  if (!ws?.claude) return null;

  return (
    <div className="border-t border-[var(--mg-border)] px-1 pt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]"
      >
        <Icon
          name="chevron_right"
          size={16}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        <ClaudeMark size={12} className="mr-0.5" />
        このセッションが書いたファイル
        {phase && (
          <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
            <span
              className={`h-1.5 w-1.5 rounded-full ${phase === "working" ? "animate-pulse" : ""}`}
              style={{ background: PHASE_COLOR[phase] }}
            />
            {PHASE_LABEL[phase]}
          </span>
        )}
      </button>
      {open && (
        <div className="max-h-[38vh] overflow-y-auto pb-2">
          {wrote.length === 0 && (
            <div className="px-3 py-2 text-[11.5px] text-[var(--mg-muted)]">
              まだ何も書いていません
            </div>
          )}
          {wrote.slice(0, SHOWN).map((w) => (
            <button
              key={w.path}
              title={w.path}
              onClick={() => {
                openFile(w.path);
                markInTree(store, w.path);
                seenTab(store, w.path);
              }}
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
          {wrote.length > SHOWN && (
            <div className="px-3 py-1 text-[11px] text-[var(--mg-muted)]">
              ほか {wrote.length - SHOWN} 件
            </div>
          )}
        </div>
      )}
    </div>
  );
}
