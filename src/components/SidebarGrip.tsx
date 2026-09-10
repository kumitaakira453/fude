import { useCallback, useEffect, useRef } from "react";
import { SIDEBAR_WIDTH, fitSidebarWidth } from "../lib/sidebar";

// 左の欄と本文のあいだの仕切り。掴んで欄の幅を変える。
//
// 幅は持たず受け取るだけ。控えの読み書きは呼び出し側に任せる。
//
// 押し下げの番に window へ張るのは、ペインの分割の仕切り（PaneGroup）と
// 同じ形。ポインタが仕切りの外へ出ても離すまで追える。
// setPointerCapture は使わない（jsdom に無く、試験から動かせない）。
export function SidebarGrip({
  target,
  width,
  onWidth,
}: {
  // 幅を当てる入れ物。掴んでいるあいだはここへ直に書く。
  target: React.RefObject<HTMLElement | null>;
  width: number;
  onWidth: (w: number) => void;
}) {
  // 掴んでいる最中の後片付け。掴んだまま部品が消えても張った分を外す。
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => release.current?.(), []);

  const start = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const from = e.clientX;
      const base = width;
      let last = base;

      const onMove = (ev: PointerEvent) => {
        last = fitSidebarWidth(base + (ev.clientX - from));
        // 掴んでいるあいだは DOM へ直に書く。
        //
        // 状態を通すと、動かした一枚ごとに木全体（ファイルツリーと本文）が
        // 描き直され、手に付いてこない。控えへ入れるのは離した 1 回だけ。
        if (target.current) target.current.style.width = `${last}px`;
      };
      const stop = () => {
        release.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      const onUp = () => {
        stop();
        onWidth(last);
      };

      release.current = stop;
      // 掴んでいるあいだは、どこへ出ても矢印を変えずに字も選ばせない。
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [target, width, onWidth],
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
