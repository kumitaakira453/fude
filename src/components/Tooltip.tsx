import type { ReactNode } from "react";

// WKWebView は title 属性のネイティブツールチップを出さないため、自前で用意する。
// align: トリガに対する水平アンカー。右端の要素は "end"（右寄せ）で画面外はみ出しを防ぐ。
export function Tooltip({
  label,
  children,
  side = "bottom",
  align = "center",
}: {
  label: string;
  children: ReactNode;
  side?: "bottom" | "top";
  align?: "center" | "start" | "end";
}) {
  const pos =
    align === "end"
      ? "right-0"
      : align === "start"
        ? "left-0"
        : "left-1/2 -translate-x-1/2";
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-max max-w-[240px] rounded-lg border border-[var(--mg-border)] bg-[var(--mg-panel)] px-2.5 py-1.5 text-[11px] leading-snug text-[var(--mg-fg-dim)] opacity-0 shadow-xl transition-opacity delay-150 duration-150 group-hover/tt:opacity-100 ${pos} ${
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
