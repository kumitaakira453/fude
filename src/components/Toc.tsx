import { useEffect, useRef, useState } from "react";

interface Heading {
  id: string;
  text: string;
  level: number;
}

// 本文の見出しを拾う。本文はブロックごとに描画するので、同じ文字の見出しは
// 同じ id になる（id を振る処理はブロックの中でしか重複を数えられない）。
// 目次はどれを指しているかを id ではなく並びの位置で持つ。id で見ると、
// 「案の比較」のような繰り返す見出しが一斉に反応してしまう。
const SELECTOR = "h1, h2, h3, h4";

function readHeadings(content: HTMLElement): HTMLElement[] {
  return Array.from(content.querySelectorAll<HTMLElement>(SELECTOR));
}

// 現在位置と見なす上端からの距離。少し下げて、見出しが画面に入った時点で
// 次へ移らないようにする。
const SPY_OFFSET = 120;

// 描画済み本文から見出しを収集し、スクロールスパイで現在位置を示す目次。
export function Toc({
  content,
  scroller,
  contentKey,
}: {
  content: HTMLElement | null;
  scroller: HTMLElement | null;
  contentKey: string;
}) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeAt, setActiveAt] = useState(-1);
  // 押したときに飛ぶ先。並びの位置で引くので、同じ文字の見出しでも取り違えない。
  const elsRef = useRef<HTMLElement[]>([]);

  // 見出し収集。本文は先頭から順に描画されるので、後から増える見出しも取り込む。
  useEffect(() => {
    if (!content) return;
    const collect = () => {
      const els = readHeadings(content);
      elsRef.current = els;
      setHeadings(
        els.map((h) => ({
          id: h.id,
          text: h.textContent ?? "",
          level: Number(h.tagName[1]),
        })),
      );
    };
    collect();
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(collect);
    });
    mo.observe(content, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [content, contentKey]);

  // スクロールスパイ
  useEffect(() => {
    if (!content || !scroller) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const els = readHeadings(content);
        elsRef.current = els;
        const top = scroller.getBoundingClientRect().top;
        let at = -1;
        for (let i = 0; i < els.length; i++) {
          if (els[i].getBoundingClientRect().top - top < SPY_OFFSET) at = i;
          else break;
        }
        setActiveAt(at < 0 && els.length > 0 ? 0 : at);
      });
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [content, scroller, contentKey]);

  if (headings.length < 2) return null;
  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <nav className="mg-toc hidden min-h-0 w-56 shrink-0 self-stretch overflow-y-auto border-l border-[var(--mg-border)] py-6 pl-4 pr-3 lg:block">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
        目次
      </div>
      <ul className="space-y-0.5">
        {headings.map((h, i) => (
          <li key={`${h.id}-${i}`}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault();
                elsRef.current[i]?.scrollIntoView({ behavior: "smooth" });
              }}
              style={{ paddingLeft: `${(h.level - minLevel) * 12}px` }}
              className={`block truncate rounded py-0.5 text-[12.5px] leading-snug transition ${
                activeAt === i
                  ? "font-medium text-[var(--mg-accent)]"
                  : "text-[var(--mg-muted)] hover:text-[var(--mg-fg-dim)]"
              }`}
              title={h.text}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
