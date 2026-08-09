import type { ReactNode } from "react";

// WKWebView は title 属性のネイティブツールチップを出さないため、自前で用意する。
export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: string;
  children: ReactNode;
  side?: "bottom" | "top";
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 rounded-md border border-[var(--mg-border)] bg-[var(--mg-panel)] px-2 py-1 text-center text-[11px] leading-snug text-[var(--mg-fg-dim)] opacity-0 shadow-lg transition-opacity delay-100 duration-150 group-hover/tt:opacity-100 ${
          side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
