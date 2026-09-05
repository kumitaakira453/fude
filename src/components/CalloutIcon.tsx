import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// コールアウトのアイコンを選び直す盤と、読むときの掴み方。
//
// 盤（IconBoard）は出す場所と選ばれたときの手だけを受け取る。読むときはアイコンが
// 生 HTML から出るので React の要素として掴めず、目印（data-mg-callout-ico）への
// 押下を本文ごと拾って盤を出す。編集面は節点を持っているので、掴み方は向こうにある。

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

// 絵文字を選ぶ盤。画面座標で貼るので、出す側は押されたアイコンの座標を渡す。
export function IconBoard({
  x,
  y,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  // 選んだアイコン。空文字はアイコンを外す。
  onPick: (icon: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    const onResize = () => close.current();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const choose = (icon: string) => {
    if (icon) remember(icon);
    onPick(icon);
  };

  const recent = recents();

  return createPortal(
    <div
      ref={boxRef}
      style={{
        left: Math.min(x, window.innerWidth - 268),
        top: Math.min(y, window.innerHeight - 300),
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
  // seq は開くたびに増やす。盤を作り直させて、前に打った絞り込みを持ち越さない。
  const [open, setOpen] = useState<{
    seq: number;
    index: number;
    x: number;
    y: number;
  } | null>(null);

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
      setOpen((was) => ({
        seq: (was?.seq ?? 0) + 1,
        index,
        x: box.left,
        y: box.bottom + 6,
      }));
    };
    content.addEventListener("click", onClick);
    return () => content.removeEventListener("click", onClick);
  }, [content]);

  if (!open) return null;

  return (
    <IconBoard
      key={open.seq}
      x={open.x}
      y={open.y}
      onPick={(icon) => {
        onPick(open.index, icon);
        setOpen(null);
      }}
      onClose={() => setOpen(null)}
    />
  );
}
