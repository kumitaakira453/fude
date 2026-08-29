import { useEffect, useRef } from "react";

// ドラッグが終わったらドロップ位置の目印を消す。
//
// 自前の onDrop / onDragLeave だけに頼ると目印が出たままになる。受け側が
// 伝播を止めると外側の onDrop は呼ばれず、取り消し（Esc や対象外で離す）では
// drop 自体が起きないため。
// drop は捕捉段階で拾う。伝播を止められても必ず届かせるため。
export function useDragReset(clear: () => void) {
  const latest = useRef(clear);
  latest.current = clear;

  useEffect(() => {
    const reset = () => latest.current();
    window.addEventListener("dragend", reset, true);
    window.addEventListener("drop", reset, true);
    return () => {
      window.removeEventListener("dragend", reset, true);
      window.removeEventListener("drop", reset, true);
    };
  }, []);
}
