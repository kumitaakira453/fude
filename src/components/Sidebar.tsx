import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  loadingAtom,
  openPickerAtom,
  rootCreateAtom,
  rootsAtom,
  sidebarTabAtom,
  soleAtom,
  treeFilterAtom,
  workspaceAtom,
} from "../state/atoms";
import { ClaudeBanner, ClaudeFiles } from "./ClaudePanel";
import { TextBtn } from "./Chrome";
import { FileTree } from "./FileTree";
import { FolderSwitcher } from "./FolderSwitcher";
import { MenuButton } from "./MenuButton";
import { SearchPanel } from "./SearchPanel";

// 左の欄。縦の帯で選んだ面（ファイル・検索・Claude）を出す。頭には面の名前と、
// その面で使う操作を字で置く。
const TITLE = { files: "ファイル", search: "検索", claude: "Claude のセッション" } as const;

export function Sidebar() {
  const face = useAtomValue(sidebarTabAtom);
  const [filter, setFilter] = useAtom(treeFilterAtom);
  const loading = useAtomValue(loadingAtom);
  const ws = useAtomValue(workspaceAtom);
  const roots = useAtomValue(rootsAtom);
  const sole = useAtomValue(soleAtom);
  const setPicker = useSetAtom(openPickerAtom);
  const askCreate = useSetAtom(rootCreateAtom);
  const { newDraft } = useWorkspace();
  // 根が 1 つのときだけ、根にそのまま作れる（複数なら根の行の右クリックから）。
  const lone = roots.length === 1 && !sole;

  return (
    <aside className="mg-pane-side">
      <div className="mg-pane-side-head">
        <span className="mg-pane-side-title">{TITLE[face]}</span>
        {face === "files" && (
          <>
            <TextBtn tip="フォルダ・ファイルを開く" keys="⌘O" quiet onClick={() => setPicker(true)}>
              開く
            </TextBtn>
            <MenuButton
              icon="add"
              label="新規"
              title="新しく作る"
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
              ]}
            />
          </>
        )}
      </div>

      {/* ワークスペースを開いていないときだけ、今のフォルダの名前と開く入口を出す。 */}
      {!ws && face === "files" && (
        <div className="border-b border-[var(--mg-border)] p-2">
          <FolderSwitcher />
        </div>
      )}

      {loading.active && (
        <div className="px-3 py-1.5 text-[var(--mg-t-xs)] text-[var(--mg-muted)]">
          {loading.message}…
          {loading.total > 0 && ` ${loading.done}/${loading.total}`}
        </div>
      )}

      {face === "files" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="p-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="ファイル名で絞り込み…"
              className="mg-input"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 pb-4">
            <FileTree />
          </div>
        </div>
      )}
      {face === "search" && (
        <div className="min-h-0 flex-1">
          <SearchPanel />
        </div>
      )}
      {face === "claude" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ClaudeBanner />
          <ClaudeFiles />
          {!ws?.claude && (
            <div className="px-3 py-4 text-[var(--mg-t-s)] text-[var(--mg-muted)]">
              このワークスペースは Claude のセッションと結びついていません。札の ＋ から、セッションのワークスペースを作れます。
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
