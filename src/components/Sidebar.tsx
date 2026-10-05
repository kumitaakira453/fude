import { useAtom, useAtomValue } from "jotai";
import { loadingAtom, sidebarTabAtom, treeFilterAtom, workspaceAtom } from "../state/atoms";
import { ClaudeBanner, ClaudeFiles } from "./ClaudePanel";
import { FileTree } from "./FileTree";
import { FolderSwitcher } from "./FolderSwitcher";
import { Icon } from "./Icon";
import { SearchPanel } from "./SearchPanel";

export function Sidebar() {
  const [tab, setTab] = useAtom(sidebarTabAtom);
  const [filter, setFilter] = useAtom(treeFilterAtom);
  const loading = useAtomValue(loadingAtom);
  const ws = useAtomValue(workspaceAtom);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[var(--mg-panel)]">
      {/* ワークスペースを開いているときは、ツールバーの札が名前と手入れの入口を
          持っているので、ここには出さない（同じものを 2 か所に置かない）。 */}
      {!ws && (
        <div className="border-b border-[var(--mg-border)] p-2">
          <FolderSwitcher />
        </div>
      )}
      <ClaudeBanner />

      <div className="flex gap-1 px-2 pt-2">
        {(
          [
            ["files", "ファイル", "folder_open"],
            ["search", "検索", "search"],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-medium transition ${
              tab === id
                ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
                : "text-[var(--mg-muted)] hover:bg-[var(--mg-hover)]"
            }`}
          >
            <Icon name={icon} size={16} fill={tab === id} />
            {label}
          </button>
        ))}
      </div>

      {loading.active && (
        <div className="px-3 py-1.5 text-[11px] text-[var(--mg-muted)]">
          {loading.message}…
          {loading.total > 0 && ` ${loading.done}/${loading.total}`}
        </div>
      )}

      {tab === "files" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="p-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="ファイル名で絞り込み…"
              className="w-full rounded-md border border-[var(--mg-border)] bg-[var(--mg-input-bg)] px-2.5 py-1.5 text-[13px] outline-none transition placeholder:text-[var(--mg-muted)] focus:border-[var(--mg-accent)]"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 pb-4">
            <FileTree />
          </div>
          <ClaudeFiles />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <SearchPanel />
        </div>
      )}
    </aside>
  );
}
