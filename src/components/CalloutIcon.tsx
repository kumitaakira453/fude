import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// コールアウトのアイコンを選び直す。アイコンは生 HTML から出るので React の
// 要素として掴めない。目印（data-mg-callout-ico）への押下を本文ごと拾う。

const RECENT_KEY = "mdglow:callout-icons";
const RECENT_MAX = 8;

// Notion のコールアウトで並ぶものに揃えた。よく使う順。
const CHOICES = [
  "💡", "⚠️", "ℹ️", "✅", "❗️", "❓", "🚫", "📌",
  "📝", "🔑", "🔒", "🔥", "🚧", "⏰", "📢", "🗣️",
  "👉", "☝️", "👀", "🎯", "🧩", "📊", "📅", "🏷️",
  "🐛", "🔧", "🛠️", "⚙️", "🚀", "✨", "💬", "📖",
];

function recents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(icon: string): void {
  const next = [icon, ...recents().filter((x) => x !== icon)].slice(
    0,
    RECENT_MAX,
  );
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 保存できなくても選び直しはできる */
  }
}

export function CalloutIcon({
  content,
  contentKey,
  onPick,
}: {
  content: HTMLElement | null;
  contentKey: string;
  // 選んだアイコン。空文字はアイコンを外す。
  onPick: (blockIndex: number, icon: string) => void;
}) {
  const [open, setOpen] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(null), [contentKey]);

  useEffect(() => {
    if (!content) return;
    const onClick = (e: MouseEvent) => {
      const ico = (e.target as Element | null)?.closest?.(
        "[data-mg-callout-ico]",
      );
      if (!ico) return;
      const blockEl = ico.closest("[data-mg-block]");
      const index = Number(blockEl?.getAttribute("data-mg-block"));
      if (!Number.isFinite(index)) return;
      e.preventDefault();
      e.stopPropagation();
      const box = ico.getBoundingClientRect();
      setTyped("");
      setOpen({ index, x: box.left, y: box.bottom + 6 });
    };
    content.addEventListener("click", onClick);
    return () => content.removeEventListener("click", onClick);
  }, [content]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", () => setOpen(null));
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  const choose = (icon: string) => {
    if (icon) remember(icon);
    onPick(open.index, icon);
    setOpen(null);
  };

  const recent = recents();

  return createPortal(
    <div
      ref={boxRef}
      style={{
        left: Math.min(open.x, window.innerWidth - 268),
        top: Math.min(open.y, window.innerHeight - 300),
      }}
      className="mg-ico-pick"
    >
      <div className="mg-ico-head">
        <input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const value = typed.trim();
            if (value) choose(value);
          }}
          placeholder="貼り付けて Enter"
          className="mg-ico-input"
        />
        <button type="button" title="アイコンを外す" onClick={() => choose("")}>
          <Icon name="delete" size={18} />
        </button>
      </div>

      {recent.length > 0 && (
        <>
          <div className="mg-ico-label">最近使った</div>
          <div className="mg-ico-grid">
            {recent.map((icon) => (
              <button
                key={`r:${icon}`}
                type="button"
                onClick={() => choose(icon)}
              >
                {icon}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mg-ico-grid">
        {CHOICES.map((icon) => (
          <button key={icon} type="button" onClick={() => choose(icon)}>
            {icon}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
