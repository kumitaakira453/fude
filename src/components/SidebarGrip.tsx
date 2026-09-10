import { useCallback } from "react";
import { SIDEBAR_WIDTH, fitSidebarWidth } from "../lib/sidebar";

// 左の欄と本文のあいだの仕切り。掴んで欄の幅を変える。
//
// 幅は持たず受け取るだけ。控えの読み書きは呼び出し側に任せる。
//
// 押し下げの番に window へ張るのは、ペインの分割の仕切り（PaneGroup）と
// 同じ形。ポインタが仕切りの外へ出ても離すまで追える。
// setPointerCapture は使わない（jsdom に無く、試験から動かせない）。
export function SidebarGrip({
  width,
  onWidth,
}: {
  width: number;
  onWidth: (w: number) => void;
}) {
  const start = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const from = e.clientX;
      const base = width;
      const onMove = (ev: PointerEvent) => {
        onWidth(fitSidebarWidth(base + (ev.clientX - from)));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      // 掴んでいるあいだは、どこへ出ても矢印を変えずに字も選ばせない。
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, onWidth],
  );

  return (
    <div
      onPointerDown={start}
      onDoubleClick={() => onWidth(SIDEBAR_WIDTH)}
      title="ドラッグで幅を変える / ダブルクリックで元に戻す"
      className="mg-side-grip"
    >
      <span className="mg-side-grip-hit" />
      <span className="mg-side-grip-line" />
    </div>
  );
}
