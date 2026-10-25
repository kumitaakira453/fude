import { useAtomValue, useSetAtom } from "jotai";
import {
  canBackAtom,
  canForwardAtom,
  paletteOpenAtom,
  railOpenAtom,
  wsRailWidthAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
} from "../state/atoms";
import { RAIL_STRIP } from "../lib/sidebar";
import { IconBtn } from "./Chrome";
import { Icon } from "./Icon";

// 上の段。窓のタイトルバーと一体で、左に信号機の場所を空ける。全体に効く
// ものだけを置く（サイドバー・戻る/進む・探す・設定）。
// 空いているところを掴むと窓を動かせる。
export function Toolbar() {
  const setSidebarOpen = useSetAtom(sidebarOpenAtom);
  const canBack = useAtomValue(canBackAtom);
  const canForward = useAtomValue(canForwardAtom);
  const setPalette = useSetAtom(paletteOpenAtom);
  const setSettings = useSetAtom(settingsOpenAtom);
  // 左の欄の開閉ボタンは、左の欄の左端の真上に置く。帯の幅から信号の場所
  // （.mg-top-lights の 80px）を引いた分だけ空ける。
  const railOpen = useAtomValue(railOpenAtom);
  const railWidth = useAtomValue(wsRailWidthAtom);
  const room = Math.max(0, (railOpen ? railWidth : RAIL_STRIP) - 80);

  return (
    <div className="mg-top" data-tauri-drag-region>
      <div className="mg-top-lights" data-tauri-drag-region />
      <span className="mg-top-room" style={{ width: room }} data-tauri-drag-region />
      <IconBtn
        tip="サイドバー"
        keys="⌘D"
        icon="left_panel"
        onClick={() => setSidebarOpen((v) => !v)}
      />
      <IconBtn tip="戻る" keys="⌘[" icon="chevron_left" disabled={!canBack} onClick={() => history.back()} />
      <IconBtn
        tip="進む"
        keys="⌘]"
        icon="chevron_right"
        disabled={!canForward}
        onClick={() => history.forward()}
      />
      <span className="mg-top-sep" />
      {/* 空いているところは窓を掴む所（ワークスペースは左端の帯に並べる）。 */}
      <span className="mg-top-fill" data-tauri-drag-region />
      <button
        type="button"
        className="mg-top-find"
        data-tip="ファイル・操作を名前で探す"
        data-key="⌘⇧P"
        onClick={() => setPalette(true)}
      >
        <Icon name="search" size={14} stroke={1.7} />
        <span className="mg-top-find-label">ファイル・操作を探す</span>
        <kbd className="mg-key">⌘⇧P</kbd>
      </button>
      <IconBtn tip="設定" keys="⌘," icon="tune" onClick={() => setSettings(true)} />
    </div>
  );
}
