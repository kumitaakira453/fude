import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL, phaseOf } from "../lib/claude";
import { rootName } from "../lib/idb";
import { ago } from "../lib/when";
import { rootsSummary, type Workspace } from "../lib/workspaces";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  claudeLinkAtom,
  claudeSessionsAtom,
  foldersAtom,
  newWorkspaceAtom,
  workspaceAtom,
  workspacesAtom,
} from "../state/atoms";
import { PHASE_COLOR } from "../state/claude";
import { ClaudeMark } from "./ClaudeMark";
import { FolderChooser } from "./FolderChooser";
import { Icon } from "./Icon";

// ワークスペースを作る小さな一覧（札の並びの末尾の ＋）。作る入口はここだけ。
// 画面は暗くしない。外を押すか Esc で閉じる。

// 並べるセッションの数。
const SESSIONS_SHOWN = 12;

export function NewWorkspace() {
  const [at, setAt] = useAtom(newWorkspaceAtom);
  const current = useAtomValue(workspaceAtom);
  const list = useAtomValue(workspacesAtom);
  const folders = useAtomValue(foldersAtom);
  const claudeOn = useAtomValue(claudeLinkAtom);
  const claude = useAtomValue(claudeSessionsAtom);
  const ops = useWorkspaceOps();
  const { openWorkspace } = useWorkspace();
  const [choosing, setChoosing] = useState(false);
  const now = useMemo(() => Date.now(), [at]);

  useEffect(() => setChoosing(false), [at]);

  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAt(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [at, setAt]);

  // セッションを新しく始めた順に。すでにワークスペースがあるものは、そのワーク
  // スペースを添える（押すと作らずにそれを開く）。
  const sessions = useMemo(() => {
    if (!claudeOn || !claude) return [];
    const byId = new Map<string, Workspace>();
    for (const w of [...list, ...(current ? [current] : [])]) {
      if (w.claude) byId.set(w.claude.sessionId, w);
    }
    return claude.sessions
      .map((s) => ({ s, ws: byId.get(s.sessionId) }))
      .sort((a, b) => (b.s.startedAt ?? 0) - (a.s.startedAt ?? 0))
      .slice(0, SESSIONS_SHOWN);
  }, [claudeOn, claude, list, current]);

  if (!at) return null;
  const close = () => setAt(null);
  const here = current ? rootsSummary(current.roots.map((r) => rootName(folders, r))) : "";

  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={close} />
      <div
        role="dialog"
        aria-label="新しいワークスペース"
        style={{ left: Math.max(8, Math.min(at.left, window.innerWidth - 448)), top: at.top }}
        className="mg-ws-menu fixed z-[56] w-[440px]"
      >
        {choosing ? (
          <FolderChooser
            mode="create"
            initial={current?.roots ?? []}
            hidden={[]}
            pickOther={ops.pickOtherFolder}
            onBack={() => setChoosing(false)}
            onDone={(roots, name, newWindow) => {
              close();
              void ops.createWorkspace({ roots, name, newWindow });
            }}
          />
        ) : (
          <>
            <div className="mg-ws-menu-head">新しいワークスペース</div>
            {current && (
              <Choice
                icon="add"
                label="今のフォルダで新規作成"
                note={here}
                onClick={() => {
                  close();
                  void ops.createWorkspace({ roots: current.roots });
                }}
              />
            )}
            <Choice
              icon="folder_open"
              label="フォルダを選んで新規作成…"
              note="以前開いたフォルダから選べます"
              onClick={() => setChoosing(true)}
            />
            {current && (
              <Choice
                icon="content_copy"
                label="今のタブを複製して新規作成"
                note="フォルダと開いているタブをそのまま引き継ぎます"
                onClick={() => {
                  close();
                  void ops.createWorkspace({ copy: true });
                }}
              />
            )}
            {claudeOn && (
              <>
                <div className="mg-ws-menu-sep" />
                <div className="mg-ws-menu-sub">
                  <ClaudeMark size={12} />
                  Claude のセッションから作成
                  <span className="mg-set-beta">Beta</span>
                </div>
                {!claude && <p className="mg-ws-menu-quiet">読み込んでいます…</p>}
                {claude?.error && (
                  <p className="mg-ws-menu-quiet" title={claude.error}>
                    Claude のセッションを読み込めません（設定の「Claude」で原因を確認できます）
                  </p>
                )}
                {claude && !claude.error && sessions.length === 0 && (
                  <p className="mg-ws-menu-quiet">セッションはありません</p>
                )}
                <div className="max-h-[36vh] overflow-y-auto">
                  {sessions.map(({ s, ws }) => {
                    const phase = phaseOf(s, { readable: true, transcriptGone: false });
                    return (
                      <button
                        key={s.sessionId}
                        type="button"
                        className={`mg-ws-menu-item${ws ? " is-made" : ""}`}
                        title={ws ? `ワークスペース「${ws.name}」を開く` : "このセッションからワークスペースを作成"}
                        onClick={() => {
                          close();
                          if (ws) void openWorkspace(ws);
                          else void ops.createFromSession(s);
                        }}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${phase === "working" ? "animate-pulse" : ""}`}
                          style={{ background: PHASE_COLOR[phase] }}
                          title={PHASE_LABEL[phase]}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {s.name || s.sessionId.slice(0, 8)}
                        </span>
                        {ws && <span className="mg-set-tag">作成済み</span>}
                        {s.startedAt ? (
                          <span className="shrink-0 text-[10.5px] text-[var(--mg-muted)]">
                            {ago(s.startedAt, now)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Choice({
  icon,
  label,
  note,
  onClick,
}: {
  icon: string;
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="mg-ws-menu-item is-tall" onClick={onClick}>
      <Icon name={icon} size={17} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        {note && <span className="truncate text-[11px] text-[var(--mg-muted)]">{note}</span>}
      </span>
    </button>
  );
}
