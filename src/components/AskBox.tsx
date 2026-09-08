import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

// 一言だけ聞く小窓。リンクの行き先と、式の中身（TeX）に使う。
//
// 帯の中の段ではなく body に置く。帯の中だと、帯の高さと幅が段の数で動くうえ、
// 上の親に transform や overflow が付いているだけで切り抜かれる（position:
// fixed の基準が親へ移る）。押しても何も出ないように見える事故はこれで起きる。

export function AskBox({
  hint,
  label,
  text,
  at,
  lines,
  onText,
  onDone,
  onClose,
}: {
  // 空のときに出す見本。
  hint: string;
  // 何を聞いているか。読み上げと試験の手掛かり。
  label: string;
  text: string;
  // 出す場所。左上。ビューポート座標。
  at: { left: number; top: number };
  // 複数行で聞く（独立した式は改行を含む）。Enter は改行になり、決めるのは
  // ⌘Enter と決めるボタン。
  lines?: boolean;
  onText: (next: string) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const field = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.select();
  }, []);

  useEffect(() => {
    // 外を押したら閉じる。押し下げでは畳まない（押した番に消えると、決める
    // ボタンの click がどこにも届かない）。
    //
    // 出した押下の続き（離す番）は数えない。メニューから選んで出したときは、
    // その click の mouseup がまだ配られていないので、受け取ると出した端から
    // 閉じてしまう。
    let live = false;
    const soon = window.setTimeout(() => {
      live = true;
    });
    const onUp = (e: MouseEvent) => {
      if (!live) return;
      if ((e.target as Element | null)?.closest?.(".mg-ask")) return;
      onClose();
    };
    window.addEventListener("mouseup", onUp);
    return () => {
      window.clearTimeout(soon);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onClose]);

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Enter") return;
    // 複数行のときの改行は本文。決めるのは ⌘Enter。
    if (lines && !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    onDone();
  };

  return createPortal(
    <div className="mg-ask" style={{ left: at.left, top: at.top }}>
      {lines ? (
        <textarea
          ref={field as React.RefObject<HTMLTextAreaElement>}
          value={text}
          placeholder={hint}
          aria-label={label}
          spellCheck={false}
          rows={Math.min(8, Math.max(2, text.split("\n").length))}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={keys}
        />
      ) : (
        <input
          ref={field as React.RefObject<HTMLInputElement>}
          value={text}
          placeholder={hint}
          aria-label={label}
          spellCheck={false}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={keys}
        />
      )}
      <Tooltip label="決める" keys={lines ? "⌘⏎" : "⏎"} side="bottom" align="end" tone="dark">
        <button
          type="button"
          aria-label="決める"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDone}
        >
          <Icon name="keyboard_return" size={16} />
        </button>
      </Tooltip>
    </div>,
    document.body,
  );
}
