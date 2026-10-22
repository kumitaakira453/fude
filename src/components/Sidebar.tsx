import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRef } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  loadingAtom,
  openPickerAtom,
  rootCreateAtom,
  rootsAtom,
  sidebarOpenAtom,
  sidebarTabAtom,
  soleAtom,
  type SideFace,
  treeFilterAtom,
  workspaceAtom,
  workspaceMenuAtom,
} from "../state/atoms";
import { phaseForAtom } from "../state/claude";
import { ClaudeBanner, ClaudeFiles, OpenedFiles } from "./ClaudePanel";
import { StatusMark } from "./StatusMark";
import { TextBtn } from "./Chrome";
import { FileTree } from "./FileTree";
import { FolderSwitcher } from "./FolderSwitcher";
import { Icon } from "./Icon";
import { MenuButton } from "./MenuButton";
import { SearchPanel } from "./SearchPanel";

// 左の欄。頭の字の切り替え（ファイル・検索）で面を選ぶ。ファイルの面では、
// 同じ行の右端に、ファイルの面で使う「開く」「＋」を置く（1 行に収める）。
const FACES: { id: SideFace; label: string; keys?: string }[] = [
  { id: "files", label: "ファイル" },
  { id: "search", label: "検索", keys: "⌘⇧F" },
  { id: "claude", label: "Claude" },
];

export function Sidebar() {
  const [face, setFace] = useAtom(sidebarTabAtom);
  const setSideOpen = useSetAtom(sidebarOpenAtom);
  const [filter, setFilter] = useAtom(treeFilterAtom);
  const loading = useAtomValue(loadingAtom);
  const ws = useAtomValue(workspaceAtom);
  const roots = useAtomValue(rootsAtom);
  const sole = useAtomValue(soleAtom);
  const setPicker = useSetAtom(openPickerAtom);
  const askCreate = useSetAtom(rootCreateAtom);
  const setWsMenu = useSetAtom(workspaceMenuAtom);
  const head = useRef<HTMLDivElement>(null);
  const { newDraft } = useWorkspace();
  // 根が 1 つのときだけ、根にそのまま作れる（複数なら根の行の右クリックから）。
  const lone = roots.length === 1 && !sole;
  const phase = useAtomValue(phaseForAtom)(ws);

  return (
    <aside className="mg-pane-side">
      <div ref={head} className="mg-pane-side-head is-faces">
        <div className="mg-side-tabs" role="tablist" aria-label="左の欄">
          {FACES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={face === f.id}
              data-key={f.keys}
              className={`mg-side-tab${face === f.id ? " is-on" : ""}`}
              // 今出している面をもう一度押すと、左の欄を閉じる（開くのは上の段の
              // サイドバーのボタンか ⌘D、または帯の札）。
              onClick={() => (face === f.id ? setSideOpen(false) : setFace(f.id))}
            >
              {f.label}
              {f.id === "claude" && <StatusMark phase={phase} />}
            </button>
          ))}
        </div>
        {face === "files" && (
          <span className="mg-side-tools">
            <TextBtn tip="フォルダ・ファイルを開く" keys="⌘O" onClick={() => setPicker(true)}>
              開く
            </TextBtn>
            <MenuButton
              icon="add"
              size={14}
              className="mg-tbtn is-icon"
              title="新しいファイル・フォルダ"
              keys="⌘N"
              items={[
                { icon: "edit_note", label: "新しいメモ", keys: "⌘N", run: () => void newDraft() },
                ...(lone
                  ? [
                      {
                        icon: "note_add",
                        label: "新規ファイル",
                        run: () => askCreate({ kind: "file", nonce: Date.now() }),
                      },
                      {
                        icon: "create_new_folder",
                        label: "新規フォルダ",
                        run: () => askCreate({ kind: "dir", nonce: Date.now() }),
                      },
                    ]
                  : []),
                ...(ws
                  ? [
                      {
                        icon: "create_new_folder",
                        label: "このワークスペースにフォルダを追加",
                        run: () => {
                          const box = head.current?.getBoundingClientRect();
                          setWsMenu({
                            id: ws.id,
                            x: box ? box.left + 8 : 0,
                            y: box ? box.bottom + 4 : 0,
                            step: "folders",
                          });
                        },
                      },
                    ]
                  : []),
              ]}
            />
          </span>
        )}
      </div>

      {/* ワークスペースを開いていないときだけ、今のフォルダの名前と開く入口を出す。 */}
      {!ws && face === "files" && (
        <div className="border-b border-[var(--mg-border)] p-2">
          <FolderSwitcher />
        </div>
      )}

      {loading.active && (
        <div className="px-3 py-1.5 text-[length:var(--mg-t-xs)] text-[var(--mg-muted)]">
          {loading.message}…
          {loading.total > 0 && ` ${loading.done}/${loading.total}`}
        </div>
      )}

      {face === "files" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <ClaudeBanner />
          <label className="mg-filter">
            <Icon name="filter_list" size={13} stroke={1.7} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="ファイル名で絞り込み"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 pb-2">
            <FileTree />
          </div>
          {ws?.claude && <ClaudeFiles />}
          {ws?.claude && <OpenedFiles />}
        </div>
      )}
      {face === "search" && (
        <div className="min-h-0 flex-1">
          <SearchPanel />
        </div>
      )}
      {face === "claude" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <ClaudeBanner />
          <ClaudeFiles fill />
          <OpenedFiles />
          {!ws?.claude && (
            <div className="px-3 py-4 text-[length:var(--mg-t-s)] text-[var(--mg-muted)]">
              このワークスペースは Claude のセッションと結びついていません。帯の ＋ から作れます。
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
