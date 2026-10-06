import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  canBackAtom,
  canForwardAtom,
  paletteOpenAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
} from "../state/atoms";
import { IconBtn } from "./Chrome";
import { Icon } from "./Icon";
import { WorkspacePills } from "./WorkspacePills";

// 上の段。窓のタイトルバーと一体で、左に信号機の場所を空ける。全体に効く
// ものだけを置く（サイドバー・戻る/進む・ワークスペースの札・探す・設定）。
// 空いているところを掴むと窓を動かせる。
export function Toolbar() {
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const canBack = useAtomValue(canBackAtom);
  const canForward = useAtomValue(canForwardAtom);
  const setPalette = useSetAtom(paletteOpenAtom);
  const setSettings = useSetAtom(settingsOpenAtom);

  return (
    <div className="mg-top" data-tauri-drag-region>
      <div className="mg-top-lights" data-tauri-drag-region />
      <IconBtn
        tip="サイドバー"
        keys="⌘D"
        icon={sidebarOpen ? "left_panel_close" : "left_panel_open"}
        on={sidebarOpen}
        onClick={() => setSidebarOpen((v) => !v)}
      />
      <IconBtn tip="戻る" keys="⌘[" icon="arrow_back" disabled={!canBack} onClick={() => history.back()} />
      <IconBtn
        tip="進む"
        keys="⌘]"
        icon="arrow_forward"
        disabled={!canForward}
        onClick={() => history.forward()}
      />
      <span className="mg-top-sep" />
      <WorkspacePills />
      <button
        type="button"
        className="mg-top-find"
        data-tip="ファイル・操作を名前で探す"
        data-key="⌘⇧P"
        onClick={() => setPalette(true)}
      >
        <Icon name="search" size={14} />
        <span>ファイル・操作を探す</span>
        <kbd className="mg-key">⌘⇧P</kbd>
      </button>
      <IconBtn tip="設定" keys="⌘," icon="tune" onClick={() => setSettings(true)} />
    </div>
  );
}
