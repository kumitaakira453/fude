import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// つまみや右押しから出す小さなメニュー。
//
// 読むときのブロックのつまみと、編集面の表のつまみが同じものを出す。並びと
// 見た目を 1 か所に置いて、どちらから出しても同じ操作に見えるようにする。

export interface MenuItem {
  icon: string;
  label: string;
  keys?: string;
  danger?: boolean;
  // いまそれである項目。選ぶ側のメニューで、どれが今かを示す。
  on?: boolean;
  run: () => void;
}

// 押した場所。画面の端では内側へ寄せる。
const ROW = 32;
// 呼び出し側が「帯の右に入るか」を測るのに使う。
export const MENU_WIDTH = 216;

export function BlockMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      onClose();
    };
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={box}
      style={{
        left: Math.min(x, window.innerWidth - MENU_WIDTH),
        top: Math.min(y, window.innerHeight - items.length * ROW - 20),
      }}
      onClick={(e) => e.stopPropagation()}
      className="mg-block-menu fixed z-50 w-[13.5rem] rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1.5 shadow-2xl"
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={() => {
            it.run();
            onClose();
          }}
          className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] transition hover:bg-[var(--mg-hover)] ${
            it.danger ? "text-[var(--mg-danger)]" : "text-[var(--mg-fg-dim)]"
          }`}
        >
          <Icon
            name={it.icon}
            size={16}
            className={`shrink-0 ${it.danger ? "" : "text-[var(--mg-muted)]"}`}
          />
          <span className="min-w-0 flex-1 truncate">{it.label}</span>
          {it.keys && <span className="mg-menu-keys shrink-0">{it.keys}</span>}
          {it.on && (
            <Icon name="check" size={15} className="shrink-0 text-[var(--mg-accent)]" />
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
