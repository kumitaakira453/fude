import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { FONTS } from "../lib/fonts";
import { THEMES } from "../lib/themes";
import { fontAtom, readingWidthAtom, themeAtom } from "../state/atoms";
import { Icon } from "./Icon";

export function ThemeSwitcher() {
  const [theme, setTheme] = useAtom(themeAtom);
  const [font, setFont] = useAtom(fontAtom);
  const [width, setWidth] = useAtom(readingWidthAtom);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="表示設定"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-[var(--mg-hover)]"
      >
        <Icon name="palette" size={19} className="text-[var(--mg-accent)]" />
        <span className="hidden text-[13px] text-[var(--mg-fg-dim)] sm:inline">
          {current.label}
        </span>
        <Icon name="expand_more" size={16} className="text-[var(--mg-muted)]" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-2 shadow-2xl">
          <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
            テーマ
          </div>
          <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto pr-0.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition ${
                  t.id === theme
                    ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
                    : "hover:bg-[var(--mg-hover)]"
                }`}
              >
                <span className="shrink-0">{t.emoji}</span>
                <span className="truncate">{t.label}</span>
              </button>
            ))}
          </div>

          <div className="my-2 h-px bg-[var(--mg-border)]" />
          <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
            書体
          </div>
          <div className="grid grid-cols-2 gap-1">
            {FONTS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFont(f.id)}
                style={{ fontFamily: f.stack }}
                className={`rounded-lg px-2 py-1.5 text-left text-[13px] transition ${
                  f.id === font
                    ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
                    : "hover:bg-[var(--mg-hover)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="my-2 h-px bg-[var(--mg-border)]" />
          <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
            本文幅
          </div>
          <div className="flex gap-1">
            {(
              [
                ["cozy", "標準"],
                ["wide", "広め"],
                ["full", "最大"],
              ] as const
            ).map(([w, label]) => (
              <button
                key={w}
                onClick={() => setWidth(w)}
                className={`flex-1 rounded-lg px-2 py-1 text-[13px] transition ${
                  w === width
                    ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
                    : "hover:bg-[var(--mg-hover)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
