import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// 下書きを閉じるときの問い。
//
// 保存先の決まっていないメモは、閉じる時点で行き先を決めさせる。黙って残すと
// 行き場の無い書きかけが溜まり、黙って消すと書いたものが消える。

export function DraftClose({
  title,
  onSave,
  onDrop,
  onClose,
}: {
  title: string;
  onSave: () => void;
  onDrop: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="mg-ver-save-back" onClick={onClose}>
      <div
        className="mg-ver-save"
        role="dialog"
        aria-label="下書きを閉じる"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mg-ver-save-head">
          <Icon name="edit_note" size={16} className="text-[var(--mg-accent)]" />
          このメモの保存先
        </div>
        <p className="mg-ver-save-note">
          「{title}」はまだどこにも保存していません。捨てると戻せません。
        </p>
        <div className="mg-ver-save-foot">
          <button type="button" className="mg-small" onClick={onClose}>
            やめる
          </button>
          <button type="button" className="mg-small is-drop" onClick={onDrop}>
            破棄する
          </button>
          <button type="button" className="mg-small is-go" onClick={onSave} autoFocus>
            保存する
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
