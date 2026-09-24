import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { editorialAtom } from "../state/atoms";
import { Icon } from "./Icon";

// 幅の長い表を、画面いっぱいで見る。
//
// 本文の幅に収める限り、列の多い表は横に送るしかない。送る距離が長いほど
// 何の行か見失うので、本文の幅から外して広げ、見出しの行と先頭の列を置いていく。
//
// 中身は描き上がった表をそのまま写す（組み直すと見たままから外れる）。
// 押せるものと編集の目印だけを落とす。
export function tablePlain(table: HTMLElement): string {
  const copy = table.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
    el.removeAttribute("data-mg-cell");
    el.removeAttribute("data-mg-block");
    el.removeAttribute("contenteditable");
  }
  return copy.outerHTML;
}

export function TableModal({ html, onClose }: { html: string; onClose: () => void }) {
  const editorial = useAtomValue(editorialAtom);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="mg-tablebox" onClick={onClose}>
      <div className="mg-tablebox-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mg-tablebox-bar">
          <button
            type="button"
            onClick={onClose}
            title="閉じる (Esc)"
            className="mg-tablebox-act"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div
          className={`mg-tablebox-body mg-prose prose${editorial ? " mg-editorial" : ""}`}
        >
          <div className="mg-table-wrap" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
