import { useAtomValue, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL } from "../lib/claude";
import { pickDirectory } from "../lib/fsAccess";
import { pickDocFile } from "../lib/kind";
import { otherRoots, railGroups } from "../lib/railGroups";
import type { Workspace } from "../lib/workspaces";
import { newWorkspaceAtom, workspaceMenuAtom, workspacesAtom } from "../state/atoms";
import { phaseForAtom } from "../state/claude";
import { barAtom } from "../state/workspaceBar";
import { AppIcon } from "./AppIcon";
import { Icon } from "./Icon";
import { MARKED } from "./StatusMark";
import { WorkspaceChip } from "./WorkspaceChip";
import { WorkspaceTidy } from "./WorkspaceTidy";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return `${m} 分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 時間前`;
  return `${Math.floor(h / 24)} 日前`;
}

// スタート画面。ワークスペースを、左端の帯と同じまとまり・同じ順で 1 行ずつ並べる。
export function Landing() {
  const list = useAtomValue(workspacesAtom);
  const bar = useAtomValue(barAtom);
  const phaseFor = useAtomValue(phaseForAtom);
  const openMenu = useSetAtom(workspaceMenuAtom);
  const setMaking = useSetAtom(newWorkspaceAtom);
  const { openFolder, openDoc, newDraft, openWorkspace } = useWorkspace();
  const { removeWorkspaces } = useWorkspaceOps();
  const [tidying, setTidying] = useState(false);

  // 列に載っていないもの（他の窓で作ったものなど）は、帯と同じく末尾に置く。
  const groups = useMemo(() => {
    const missing = list.filter((w) => !bar.includes(w.id)).map((w) => w.id);
    return railGroups([...bar, ...missing], list);
  }, [bar, list]);
  const gone = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.flatMap((ws) => {
          const phase = phaseFor(ws);
          return phase && MARKED[phase] === "gone" ? [{ ws, phase }] : [];
        }),
      ),
    [groups, phaseFor],
  );
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  const pickFolder = async () => {
    const path = await pickDirectory();
    if (path) await openFolder(path);
  };

  const pickFile = async () => {
    const path = await pickDocFile();
    if (path) openDoc(path);
  };

  const menu = (e: React.MouseEvent, ws: Workspace) => {
    e.preventDefault();
    openMenu({ id: ws.id, x: e.clientX, y: e.clientY });
  };

  const acts = (
    <div className="mg-landing-acts">
      <button className="mg-landing-act is-main" onClick={() => setMaking(true)}>
        <Icon name="add" size={14} />
        ワークスペースを作る
      </button>
      <button className="mg-landing-act" onClick={() => void pickFolder()}>
        <Icon name="folder_open" size={14} />
        フォルダを開く
      </button>
      <button className="mg-landing-act" onClick={() => void pickFile()}>
        <Icon name="description" size={14} />
        ファイルを開く
      </button>
      <button className="mg-landing-act" onClick={() => void newDraft()}>
        <Icon name="note_add" size={14} />
        新しいメモ
      </button>
    </div>
  );

  const mark = (
    <div className="mg-landing-mark">
      <AppIcon size={24} className="shrink-0 text-[var(--mg-accent)]" />
      <h1 className="mg-wordmark">fude</h1>
    </div>
  );

  return (
    <div className="mg-landing flex h-full flex-col">
      {/* 窓のタイトルバーの代わり。掴むと窓を動かせる（ほかの全面の画面と同じ帯）。 */}
      <header className="mg-screenbar" data-tauri-drag-region />

      {total === 0 ? (
        <div className="mg-landing-empty">
          {mark}
          {acts}
        </div>
      ) : (
        <div className="mg-landing-body">
          <div className="mg-landing-top">
            {mark}
            {acts}
          </div>
          <h2 className="mg-landing-head">
            ワークスペース
            <span className="mg-landing-head-n">{total}</span>
            {gone.length > 0 && (
              <button
                type="button"
                className="mg-landing-tidy"
                data-tip="終了・削除済みのセッションのワークスペースをまとめて削除"
                onClick={() => setTidying(true)}
              >
                整理（{gone.length}）
              </button>
            )}
          </h2>
          <div className="mg-landing-list">
            {groups.map((g) => (
              <section key={g.key} className="mg-landing-group">
                <h3 className="mg-landing-group-head">{g.label}</h3>
                {g.items.map((ws) => {
                  const phase = phaseFor(ws);
                  const state = phase ? MARKED[phase] : undefined;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      data-ws={ws.id}
                      data-tip={ws.name}
                      className={`mg-landing-row${state === "gone" ? " is-gone" : ""}`}
                      onClick={() => void openWorkspace(ws)}
                      onMouseDown={(e) => {
                        // 右ボタンで押した瞬間に、下の語が選ばれるのを止める。
                        if (e.button === 2) e.preventDefault();
                      }}
                      onContextMenu={(e) => menu(e, ws)}
                    >
                      <WorkspaceChip ws={ws} size={28} />
                      <span className="mg-landing-text">
                        <span className="mg-landing-name">{ws.name}</span>
                        <span className="mg-landing-where">
                          {g.label}
                          {otherRoots(ws) > 0 && ` ＋${otherRoots(ws)}`}
                        </span>
                      </span>
                      {phase && state && state !== "done" && (
                        <span className={`mg-landing-state is-${state}`}>{PHASE_LABEL[phase]}</span>
                      )}
                      <span className="mg-landing-when">{timeAgo(ws.lastOpened)}</span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      )}

      {tidying && (
        <WorkspaceTidy
          items={gone}
          onClose={() => setTidying(false)}
          onGo={(ids) => {
            setTidying(false);
            void removeWorkspaces(ids);
          }}
        />
      )}
    </div>
  );
}
