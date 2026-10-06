import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";

// 画面の周りの小さな部品。形は 2 段（角丸 4px、高さ 24 / 28px）にそろえ、
// 説明は吹き出し（data-tip）、キーは data-key で持たせる（⌘ を押すと重ねて出る）。

type Base = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  tip: string;
  keys?: string;
  on?: boolean;
};

// 絵だけのボタン。どのアプリでも意味が通じるもの（戻る・閉じる・サイドバー）と、
// 縦の帯のように吹き出しで名前を必ず出すものに限って使う。
export const IconBtn = forwardRef<HTMLButtonElement, Base & { icon: string; size?: number }>(
  function IconBtn({ tip, keys, on, icon, size = 16, className = "", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        data-tip={tip}
        data-key={keys}
        aria-label={tip}
        aria-pressed={on}
        className={`mg-ibtn${on ? " is-on" : ""} ${className}`}
        {...rest}
      >
        <Icon name={icon} size={size} />
      </button>
    );
  },
);

// 字のボタン。絵は添えるだけ。
export const TextBtn = forwardRef<
  HTMLButtonElement,
  Base & { icon?: string; children: ReactNode; quiet?: boolean }
>(function TextBtn({ tip, keys, on, icon, children, quiet, className = "", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-tip={tip}
      data-key={keys}
      aria-pressed={on}
      className={`mg-tbtn${quiet ? " is-quiet" : ""}${on ? " is-on" : ""} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
});
