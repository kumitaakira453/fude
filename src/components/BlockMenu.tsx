import { useEffect, useRef, useState } from "react";
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
  // ここでは選べないもの。押せないようにして、なぜ無いのかを黙らせない
  // （表のセルの中では見出しにできない、など）。
  disabled?: boolean;
  // 横へ開く一覧。持っているものは押すと開き、それ自身は何もしない。
  items?: MenuItem[];
  run?: () => void;
}

// 押した場所。画面の端では内側へ寄せる。
const ROW = 32;
// 呼び出し側が「帯や段の横に入るか」を測るのに使う。
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
  // 横へ開いている一覧。
  const [sub, setSub] = useState<{ x: number; y: number; items: MenuItem[] } | null>(
    null,
  );

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // 自分と、横へ開いた一覧の中は外と見ない。閉じてしまうと、押した番に
      // 相手が消えて click がどこにも届かない。
      if ((e.target as Element | null)?.closest?.(".mg-block-menu")) return;
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

  return (
    <>
      {createPortal(
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
              disabled={it.disabled}
              onClick={(e) => {
                if (it.items) {
                  // 横へ出す。上下だとこのメニュー自身に重なる。
                  const from = box.current?.getBoundingClientRect();
                  const row = e.currentTarget.getBoundingClientRect();
                  const right = (from?.right ?? row.right) + 6;
                  setSub({
                    x:
                      right + MENU_WIDTH <= window.innerWidth
                        ? right
                        : (from?.left ?? row.left) - 6 - MENU_WIDTH,
                    y: row.top - 6,
                    items: it.items,
                  });
                  return;
                }
                it.run?.();
                onClose();
              }}
              className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
                it.disabled
                  ? "cursor-default opacity-40"
                  : "hover:bg-[var(--mg-hover)]"
              } ${it.danger ? "text-[var(--mg-danger)]" : "text-[var(--mg-fg-dim)]"}`}
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
              {it.items && (
                <Icon
                  name="chevron_right"
                  size={16}
                  className="shrink-0 text-[var(--mg-muted)]"
                />
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}

      {sub && (
        <BlockMenu
          x={sub.x}
          y={sub.y}
          // 選んだら親ごと閉じる。開いたままだと、変換した後の種別と一覧の
          // 印が食い違って見える。
          items={sub.items.map((one) => ({
            ...one,
            run: () => {
              one.run?.();
              onClose();
            },
          }))}
          onClose={() => setSub(null)}
        />
      )}
    </>
  );
}
