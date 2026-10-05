import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useImeSafeEnter } from "../../hooks/useImeSafeEnter";
import { useWorkspaceOps } from "../../hooks/useWorkspaceOps";
import { rootName } from "../../lib/idb";
import { ago } from "../../lib/when";
import {
  colorVar,
  rootsSummary,
  WORKSPACE_COLORS,
  type Workspace,
} from "../../lib/workspaces";
import { foldersAtom, workspaceAtom, workspacesAtom } from "../../state/atoms";
import { refreshWorkspaces } from "../../state/workspace";
import { addToBar, barAtom, removeFromBar } from "../../state/workspaceBar";
import { FolderChooser } from "../FolderChooser";
import { Icon } from "../Icon";

// ワークスペースの面。今のワークスペースのフォルダと、控えてある全部の一覧。
// 名前・色はその場で変え、列に出すかを切り替え、要らなくなったものは消す。

function matches(ws: Workspace, names: string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [ws.name, ...names, ...ws.roots].join(" ").toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function WorkspacesPane({ query = "" }: { query?: string }) {
  const store = useStore();
  const list = useAtomValue(workspacesAtom);
  const current = useAtomValue(workspaceAtom);
  const folders = useAtomValue(foldersAtom);
  const [bar, setBar] = useAtom(barAtom);
  const ops = useWorkspaceOps();
  const [adding, setAdding] = useState(false);
  const now = useMemo(() => Date.now(), []);

  useEffect(() => {
    void refreshWorkspaces(store);
  }, [store]);

  const all = useMemo(() => {
    const merged = current
      ? list.some((w) => w.id === current.id)
        ? list.map((w) => (w.id === current.id ? current : w))
        : [current, ...list]
      : list;
    return merged
      .map((ws) => ({ ws, names: ws.roots.map((r) => rootName(folders, r)) }))
      .filter(({ ws, names }) => matches(ws, names, query));
  }, [list, current, folders, query]);

  const askDelete = async (ws: Workspace) => {
    const ok = await confirm(
      `ワークスペース「${ws.name}」を消しますか？\nフォルダとファイルはそのまま残ります。`,
      { title: "ワークスペースを消す", kind: "warning" },
    );
    if (ok) await ops.deleteWorkspace(ws.id);
  };

  return (
    <>
      {current && !query && (
        <section className="mg-set-group">
          <h3 className="mg-set-group-title">いまのワークスペースのフォルダ</h3>
          <div className="mg-set-card">
            {current.roots.map((root, i) => (
              <div key={root} className="mg-set-row is-static">
                <Icon name="folder" size={16} className="text-[var(--mg-muted)]" />
                <span className="mg-set-row-main">
                  <span className="mg-set-row-name">
                    {rootName(folders, root)}
                    {i === 0 && current.roots.length > 1 && <span className="mg-set-tag">主</span>}
                  </span>
                  <span className="mg-set-note">{root}</span>
                </span>
                {current.roots.length > 1 && (
                  <button
                    type="button"
                    className="mg-quiet mg-set-btn"
                    onClick={() => void ops.removeRoot(root)}
                  >
                    外す
                  </button>
                )}
              </div>
            ))}
            {adding ? (
              <div className="mg-set-embed">
                <FolderChooser
                  mode="add"
                  initial={[]}
                  hidden={current.roots}
                  pickOther={ops.pickOtherFolder}
                  onBack={() => setAdding(false)}
                  onDone={(roots) => {
                    setAdding(false);
                    void ops.addRoots(roots);
                  }}
                />
              </div>
            ) : (
              <button type="button" className="mg-set-row mg-set-add" onClick={() => setAdding(true)}>
                <Icon name="add" size={16} />
                <span className="mg-set-row-main">
                  <span className="mg-set-row-name">フォルダを足す</span>
                </span>
              </button>
            )}
          </div>
        </section>
      )}

      <section className="mg-set-group">
        <h3 className="mg-set-group-title">すべてのワークスペース</h3>
        <div className="mg-set-card">
          {all.length === 0 && (
            <p className="mg-set-none">
              {query ? `「${query}」に当たるワークスペースはありません` : "ワークスペースはまだありません"}
            </p>
          )}
          {all.map(({ ws, names }) => (
            <WorkspaceRow
              key={ws.id}
              ws={ws}
              summary={rootsSummary(names)}
              here={ws.id === current?.id}
              inBar={bar.includes(ws.id)}
              when={ws.lastOpened > 0 ? ago(ws.lastOpened, now) : ""}
              onRename={(name) => ops.renameWorkspace(ws.id, name)}
              onColor={(color) => ops.recolorWorkspace(ws.id, color)}
              onBar={(on) => setBar((was) => (on ? addToBar(was, ws.id) : removeFromBar(was, ws.id)))}
              onDelete={() => void askDelete(ws)}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function WorkspaceRow({
  ws,
  summary,
  here,
  inBar,
  when,
  onRename,
  onColor,
  onBar,
  onDelete,
}: {
  ws: Workspace;
  summary: string;
  here: boolean;
  inBar: boolean;
  when: string;
  onRename: (name: string) => void;
  onColor: (color: Workspace["color"]) => void;
  onBar: (on: boolean) => void;
  onDelete: () => void;
}) {
  const [painting, setPainting] = useState(false);
  const ime = useImeSafeEnter();
  return (
    <div className="mg-set-row is-static mg-set-ws">
      <button
        type="button"
        title="色を変える"
        onClick={() => setPainting((v) => !v)}
        className="mg-set-ws-dot"
      >
        <span className="mg-ws-dot" style={{ background: colorVar(ws.color) }} />
      </button>
      <span className="mg-set-row-main">
        <span className="flex items-center gap-1.5">
          <input
            key={ws.name}
            defaultValue={ws.name}
            aria-label="ワークスペースの名前"
            onKeyUp={ime.onKeyUp}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return;
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) => onRename(e.currentTarget.value)}
            className="mg-set-ws-name"
          />
          {here && <span className="mg-set-tag is-on">このウィンドウ</span>}
        </span>
        <span className="mg-set-note">
          {summary}
          {when && ` ・ ${when}`}
        </span>
        {painting && (
          <span className="mg-set-ws-colors">
            {WORKSPACE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => {
                  onColor(color);
                  setPainting(false);
                }}
                className={color === ws.color ? "is-on" : ""}
              >
                <span className="mg-ws-dot" style={{ background: colorVar(color) }} />
              </button>
            ))}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={inBar}
        title={inBar ? "列から外す" : "列に出す"}
        onClick={() => onBar(!inBar)}
        className="mg-set-ws-bar"
      >
        <span className="mg-set-note">列</span>
        <span className={`mg-switch${inBar ? " is-on" : ""}`}>
          <i />
        </span>
      </button>
      <button
        type="button"
        title={here ? "開いているワークスペースは消せません" : "消す"}
        disabled={here}
        onClick={onDelete}
        className="mg-set-ws-del"
      >
        <Icon name="delete" size={16} />
      </button>
    </div>
  );
}
