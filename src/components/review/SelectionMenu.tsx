import type { ReactNode } from "react";
import { Icon } from "../Icon";

// 字を選んだときに出る操作。コメントはどの画面でも出し、その画面だけの操作は
// 後ろへ足す。
//
// mousedown で処理する。click を待つと、押した時点でブラウザが選択を解除し、
// selectionchange でこのメニュー自身が消えるため mouseup がどこにも届かない。
// preventDefault で選択の解除も止める。
export function SelectionMenu({
  at,
  onComment,
  children,
}: {
  // 選んだ範囲の矩形。メニューはこのすぐ下に出す。
  at: { bottom: number; left: number };
  onComment: () => void;
  children?: ReactNode;
}) {
  return (
    <div style={{ top: at.bottom + 6, left: at.left }} className="mg-sel-menu">
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
