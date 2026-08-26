import { useEffect, useState } from "react";

interface Heading {
  id: string;
  text: string;
  level: number;
}

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
  const [activeId, setActiveId] = useState("");

  // 見出し収集。本文は先頭から順に描画されるので、後から増える見出しも取り込む。
  useEffect(() => {
    if (!content) return;
    const collect = () => {
      const hs = Array.from(
        content.querySelectorAll<HTMLElement>("h1, h2, h3, h4"),
      );
      setHeadings(
        hs.map((h) => ({
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
        const hs = Array.from(content.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
        const top = scroller.getBoundingClientRect().top;
        let current = "";
        for (const h of hs) {
          if (h.getBoundingClientRect().top - top < 120) current = h.id;
          else break;
        }
        setActiveId(current || hs[0]?.id || "");
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
                content?.querySelector(`#${CSS.escape(h.id)}`)?.scrollIntoView({ behavior: "smooth" });
              }}
              style={{ paddingLeft: `${(h.level - minLevel) * 12}px` }}
              className={`block truncate rounded py-0.5 text-[12.5px] leading-snug transition ${
                activeId === h.id
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
