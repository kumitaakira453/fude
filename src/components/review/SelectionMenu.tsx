import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { placeNear, roomOf } from "../../lib/floatAt";
import { Icon } from "../Icon";

// 字を選んだときに出る操作。コメントはどの画面でも出し、その画面だけの操作は
// 後ろへ足す。
//
// mousedown で処理する。click を待つと、押した時点でブラウザが選択を解除し、
// selectionchange でこのメニュー自身が消えるため mouseup がどこにも届かない。
// preventDefault で選択の解除も止める。
export function SelectionMenu({
  at,
  within,
  onComment,
  children,
}: {
  // 選んだ範囲の矩形。メニューはこのすぐ下に出す（下に入らなければ上）。
  at: { top?: number; bottom: number; left: number };
  // 収める枠。渡されなければ画面ぜんたい。
  within?: HTMLElement | null;
  onComment: () => void;
  children?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // 測る前の 1 枚は下に置く（多くの場合そこで足りる）。
  const [place, setPlace] = useState({ top: at.bottom + 6, left: at.left });
  const { top = at.bottom, bottom, left } = at;
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const fit = () => {
      const size = el.getBoundingClientRect();
      setPlace(placeNear({ top, bottom, left }, size, roomOf(within)));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [top, bottom, left, within]);

  return (
    <div ref={panel} style={{ top: place.top, left: place.left }} className="mg-sel-menu">
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onComment();
        }}
      >
        <Icon name="add_comment" size={14} />
        コメント
      </button>
      {children}
    </div>
  );
}

// メニューの区切りと、追加の操作。呼ぶ側が並べる。
export function SelectionAct({
  icon,
  label,
  onPick,
}: {
  icon: string;
  label: string;
  onPick: () => void;
}) {
  return (
    <>
      <span className="mg-sel-menu-sep" />
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onPick();
        }}
      >
        <Icon name={icon} size={14} />
        {label}
      </button>
    </>
  );
}
