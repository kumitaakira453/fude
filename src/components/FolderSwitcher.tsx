import { useAtomValue, useSetAtom } from "jotai";
import {
  activeFolderIdAtom,
  foldersAtom,
  openPickerAtom,
  soleAtom,
  workspaceAtom,
  workspaceSwitcherOpenAtom,
} from "../state/atoms";
import { draftNameAtom } from "../state/drafts";
import { displayName } from "../lib/fsAccess";
import { folderDisplayName } from "../lib/idb";
import { colorVar } from "../lib/workspaces";
import { Icon } from "./Icon";

// いま何を開いているかを出す釦。
//
// ワークスペースを開いているときは、その名前と色を出す。押すとワークスペースを
// 切り替える一覧（⌘⇧P）が出る。1 枚だけ開いているときは、開くものを選ぶ画面
// （OpenPicker）が出る。
//
// 一覧そのものはここに持たない。数が増えるほど狭いプルダウンの中を
// 延々と送ることになる。

export function FolderSwitcher() {
  const folders = useAtomValue(foldersAtom);
  const activeId = useAtomValue(activeFolderIdAtom);
  const sole = useAtomValue(soleAtom);
  const ws = useAtomValue(workspaceAtom);
  // 下書きは置き場も名前も人に見せるものではない。中身から採った名前を出す。
  const draftName = useAtomValue(draftNameAtom);
  const setPicker = useSetAtom(openPickerAtom);
  const setSwitcher = useSetAtom(workspaceSwitcherOpenAtom);

  const active = folders.find((f) => f.id === activeId);

  if (ws && !sole) {
    return (
      <button
        onClick={() => setSwitcher(true)}
        title="ワークスペースを切り替える (⌘⇧P)"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--mg-hover)]"
      >
        <span className="mg-ws-dot" style={{ background: colorVar(ws.color) }} />
        <span className="truncate text-[13px] font-semibold text-[var(--mg-fg)]">{ws.name}</span>
        <Icon name="unfold_more" size={17} className="ml-auto text-[var(--mg-muted)]" />
      </button>
    );
  }

  return (
    <button
      onClick={() => setPicker(true)}
      title="開く (⌘O)"
      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--mg-hover)]"
    >
      <Icon
        name={draftName ? "edit_note" : sole ? "description" : "folder"}
        size={18}
        fill
        className={draftName ? "text-[var(--mg-accent)]" : "text-[var(--mg-accent2)]"}
      />
      <span
        className="truncate text-[13px] font-semibold text-[var(--mg-fg)]"
        title={draftName ? undefined : (sole ?? undefined)}
      >
        {draftName ||
          (sole ? displayName(sole) : active ? folderDisplayName(active) : "フォルダ")}
      </span>
      <Icon name="unfold_more" size={17} className="ml-auto text-[var(--mg-muted)]" />
    </button>
  );
}
