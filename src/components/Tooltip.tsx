import type { ReactNode } from "react";

// WKWebView は title 属性のネイティブツールチップを出さないため、自前で用意する。
// align: トリガに対する水平アンカー。右端の要素は "end"（右寄せ）で画面外はみ出しを防ぐ。
// tone: パネル色（既定）か、地と字を入れ替えた濃い色。並んだアイコンの説明を
//       出すときは濃いほうが本文の邪魔にならない。
export function Tooltip({
  label,
  keys,
  children,
  side = "bottom",
  align = "center",
  tone = "panel",
}: {
  label: string;
  // 打鍵。あれば説明の後ろに淡く添える。
  keys?: string;
  children: ReactNode;
  side?: "bottom" | "top";
  align?: "center" | "start" | "end";
  tone?: "panel" | "dark";
}) {
  const pos =
    align === "end"
      ? "right-0"
      : align === "start"
        ? "left-0"
        : "left-1/2 -translate-x-1/2";
  const skin =
    tone === "dark"
      ? "border-transparent bg-[var(--mg-fg)] text-[var(--mg-bg)] shadow-lg"
      : "border-[var(--mg-border)] bg-[var(--mg-panel)] text-[var(--mg-fg-dim)] shadow-xl";
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-max max-w-[240px] whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] leading-snug opacity-0 transition-opacity delay-150 duration-150 group-hover/tt:opacity-100 ${skin} ${pos} ${
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2"
        }`}
      >
        {label}
        {keys && <span className="ml-1.5 opacity-55">{keys}</span>}
      </span>
    </span>
  );
}
