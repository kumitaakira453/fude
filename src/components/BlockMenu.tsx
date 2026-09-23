import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { TaskBox } from "./TaskBox";

// つまみや右押しから出す小さなメニュー。
//
// 読むときのブロックのつまみと、編集面の表のつまみが同じものを出す。並びと
// 見た目を 1 か所に置いて、どちらから出しても同じ操作に見えるようにする。

export interface MenuItem {
  icon: string;
  // 合字の絵では表せないもの（タスクの印）。あればこちらを描く。
  mark?: string;
  label: string;
  keys?: string;
  danger?: boolean;
  // いまそれである項目。選ぶ側のメニューで、どれが今かを地色で示す。
  // 印を足すと、記号の欄が右端に寄る作りのせいでその行だけ桁がずれる。
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

// メニューと相手の間に置く隙間。
const GAP = 8;
// 画面の端に残す余白。
const EDGE = 8;

export function BlockMenu({
  x,
  y,
  avoid,
  bounds,
  items,
  onClose,
}: {
  x: number;
  y: number;
  // 隠してはいけない相手（画面の座標）。メニューが何に対するものかを
  // 塗って示しているので、その塗りを覆うと何を選んだのか読めなくなる。
  avoid?: { top: number; bottom: number };
  // 出してよい範囲（本文の見えている領域）。渡されなければ窓いっぱい。
  // タブの帯の上まで出ると、開いた一枚が窓の飾りを覆って浮いて見える。
  bounds?: { top: number; bottom: number };
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
            top: placeY(y, avoid, items.length, bounds),
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
              className={`mg-menu-row${it.on ? " is-on" : ""} flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
                it.disabled
                  ? "cursor-default opacity-40"
                  : "hover:bg-[var(--mg-hover)]"
              } ${it.danger ? "text-[var(--mg-danger)]" : "text-[var(--mg-fg-dim)]"}`}
            >
              {it.mark === undefined ? (
                <Icon
                  name={it.icon}
                  size={16}
                  className={`shrink-0 ${it.danger ? "" : "text-[var(--mg-muted)]"}`}
                />
              ) : (
                <span className="shrink-0 text-[var(--mg-muted)]">
                  <TaskBox mark={it.mark} size={16} />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.keys && <span className="mg-menu-keys shrink-0">{it.keys}</span>}
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

// 縦の置き場所。相手を丸ごと覆ってしまうときだけ、その下（入らなければ上）へ
// 逃がす。相手がメニューより背の高いブロックなら、押した高さのまま出す
// （下へ回すとブロックの丈だけ離れてしまい、上下の余りで塗りは読める）。
function placeY(
  y: number,
  avoid: { top: number; bottom: number } | undefined,
  rows: number,
  bounds?: { top: number; bottom: number },
): number {
  const height = rows * ROW + 20;
  const top = (bounds?.top ?? 0) + EDGE;
  const bottom = (bounds?.bottom ?? window.innerHeight) - EDGE;
  // 見えている範囲からはみ出さない。上にぶつかるなら、できる限り上で止める。
  const fit = Math.max(top, Math.min(y, bottom - height));
  if (!avoid || avoid.bottom - avoid.top >= height) return fit;
  const below = avoid.bottom + GAP;
  if (below + height <= bottom) return below;
  const above = avoid.top - GAP - height;
  if (above >= top) return above;
  // どちらにも入らないときは範囲に収める（相手は覆うが、読めない方が困る）。
  return fit;
}
