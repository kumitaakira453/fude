import { useSetAtom } from "jotai";
import { settingsOpenAtom } from "../state/atoms";
import { Icon } from "./Icon";

// 設定への入口。中身は Settings が持つ。
export function SettingsButton() {
  const setOpen = useSetAtom(settingsOpenAtom);
  return (
    <button
      onClick={() => setOpen(true)}
      title="設定（⌘,）"
      className="flex items-center rounded-lg px-1.5 py-1.5 text-sm text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
    >
      <Icon name="tune" size={19} />
    </button>
  );
}
