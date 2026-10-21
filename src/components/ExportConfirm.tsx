import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// .d2 を SVG に書き出す前の問い。書き出す先の名前と、上書きになるかを見せる。

export function ExportConfirm({
  name,
  exists,
  onGo,
  onClose,
}: {
  name: string;
  exists: boolean;
  onGo: () => void;
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
        aria-label="SVG に書き出す"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mg-ver-save-head">
          <Icon name="save" size={16} className="text-[var(--mg-accent)]" />
          SVG に書き出す
        </div>
        <p className="mg-ver-save-note">
          同じフォルダの {name} に書き出します。
          {exists && <>すでにある {name} を上書きします。</>}
        </p>
        <div className="mg-ver-save-foot">
          <button type="button" className="mg-small" onClick={onClose}>
            やめる
          </button>
          <button type="button" className="mg-small is-go" onClick={onGo} autoFocus>
            {exists ? "上書きする" : "書き出す"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
