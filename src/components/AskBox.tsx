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
  onText,
  onDone,
  onClose,
}: {
  // 空のときに出す見本。
  hint: string;
  // 何を聞いているか。読み上げと試験の手掛かり。
  label: string;
  text: string;
  // 出す場所。帯の左下。ビューポート座標。
  at: { left: number; top: number };
  onText: (next: string) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.select();
  }, []);

  useEffect(() => {
    // 外を押したら閉じる。押し下げでは畳まない（押した番に消えると、
    // 決めるボタンの click がどこにも届かない）。
    const onUp = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(".mg-ask")) return;
      onClose();
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [onClose]);

  return createPortal(
    <div className="mg-ask" style={{ left: at.left, top: at.top }}>
      <input
        ref={field}
        value={text}
        placeholder={hint}
        aria-label={label}
        spellCheck={false}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key !== "Enter") return;
          e.preventDefault();
          onDone();
        }}
      />
      <Tooltip label="決める" keys="⏎" side="bottom" align="end" tone="dark">
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
