import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

// 押すとその足元に小さな一覧を出す釦。
//
// 役割の近い操作を 1 つの入口へ畳むために使う。絵を横へ並べ続けると、どれが
// 何なのか絵だけでは読み取れなくなる——択一の状態（右の欄）や、同じ相手への
// 別のやり方（右に分割 / 下に分割）は、並べるより中で選ばせるほうが短い。
//
// 場所を指定して開くメニュー（EntryMenu）とは別物。あちらは右押しの場所に出す。

export interface MenuItem {
  icon: string;
  label: string;
  // 押し方。あるものだけ添える。
  keys?: string;
  // いまそれである項目。地色で示す。
  on?: boolean;
  disabled?: boolean;
  // 選べない理由。押せない釦は、なぜ押せないのかをその場で出す。
  why?: string;
  run: () => void;
}

export function MenuButton({
  icon,
  title,
  items,
  active,
  disabled,
  dot,
  size = 18,
  className,
}: {
  icon: string;
  title: string;
  items: MenuItem[];
  // 釦そのものが今の状態を持つとき（右の欄など）。
  active?: boolean;
  disabled?: boolean;
  // 畳んだ中に印いているものがあるとき。畳むと状態が見えなくなるので点で添える。
  dot?: boolean;
  size?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          className ??
          `grid h-8 w-8 place-items-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
            active || open
              ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
              : "text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
          }`
        }
      >
        <Icon name={icon} size={size} />
        {dot && <span className="mg-menu-dot" />}
      </button>
      {open && (
        <div role="menu" className="mg-menu-pop">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              title={it.why}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
              className={`mg-menu-row${it.on ? " is-on" : ""} flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--mg-fg-dim)] transition ${
                it.disabled ? "cursor-default opacity-40" : "hover:bg-[var(--mg-hover)]"
              }`}
            >
              <Icon name={it.icon} size={16} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.keys && <span className="mg-menu-keys shrink-0">{it.keys}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
