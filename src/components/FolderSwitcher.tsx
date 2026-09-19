import { useAtomValue, useSetAtom } from "jotai";
import { activeFolderIdAtom, foldersAtom, openPickerAtom, soleAtom } from "../state/atoms";
import { draftNameAtom } from "../state/drafts";
import { displayName } from "../lib/fsAccess";
import { folderDisplayName } from "../lib/idb";
import { Icon } from "./Icon";

// いま何を開いているかを出す釦。押すと開くものを選ぶ画面（OpenPicker）が出る。
//
// 一覧そのものはここに持たない。フォルダが増えるほど狭いプルダウンの中を
// 延々と送ることになり、1 枚で開いたファイルの履歴も並べる場所が無かった。

export function FolderSwitcher() {
  const folders = useAtomValue(foldersAtom);
  const activeId = useAtomValue(activeFolderIdAtom);
  const sole = useAtomValue(soleAtom);
  // 下書きは置き場も名前も人に見せるものではない。中身から採った名前を出す。
  const draftName = useAtomValue(draftNameAtom);
  const setPicker = useSetAtom(openPickerAtom);

  const active = folders.find((f) => f.id === activeId);

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
