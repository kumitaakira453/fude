import { startTransition, useEffect, useRef, useState } from "react";
import type { Block } from "../../lib/blocks";
import { Markdown } from "../Markdown";

// 指摘が付いた文書を、現在の姿のまま出す。
//
// 版どうしの差分をまるごと並べていた頃は、指摘と関係のない書き換えが延々と
// 続いて何を見ればいいのか分からなかった。読み手が知りたいのは「指摘の箇所が
// 今どうなっているか」の一点なので、前後を見せるのはそこだけにする。
//
// 全ブロックを 1 回のペイントで描くと大きなファイルで固まるので、
// 本文と同じく先頭から順に足していく。

const FIRST_CHUNK = 24;
const NEXT_CHUNK = 40;

export type Anchor =
  | { state: "unchanged"; index: number }
  | { state: "rewritten"; index: number; before: string }
  | { state: "removed"; index: number; before: string }
  | { state: "unknown"; candidates: number[] };

const SPOT_LABEL: Record<string, string> = {
  unchanged: "指摘の箇所",
  rewritten: "指摘の箇所（書き換え済み）",
  removed: "ここに在った",
};

export function DocumentView({
  blocks,
  anchor,
  editorial,
  style,
}: {
  blocks: Block[];
  anchor: Anchor;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  const [limit, setLimit] = useState(FIRST_CHUNK);
  const targetRef = useRef<HTMLDivElement>(null);
  // 自分でスクロールしたら、そこから先は勝手に動かさない
  const touchedRef = useRef(false);

  useEffect(() => {
    setLimit(FIRST_CHUNK);
    touchedRef.current = false;
  }, [blocks, anchor]);

  useEffect(() => {
    if (limit >= blocks.length) return;
    const id = requestAnimationFrame(() => {
      startTransition(() => setLimit((n) => Math.min(n + NEXT_CHUNK, blocks.length)));
    });
    return () => cancelAnimationFrame(id);
  }, [limit, blocks.length]);

  useEffect(() => {
    const mark = () => {
      touchedRef.current = true;
    };
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("keydown", mark);
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("keydown", mark);
    };
  }, []);

  // 描き足すたびに位置を合わせ直す。上にある画像や数式が遅れて入ると
  // 対象が押し下げられるため、1 回きりだと狙った場所からずれる。
  // 上の余白は CSS の scroll-margin-top（.mg-anchor）で取る。
  useEffect(() => {
    if (touchedRef.current) return;
    targetRef.current?.scrollIntoView({ block: "start" });
  }, [limit, blocks, anchor]);

  if (blocks.length === 0) {
    return <p className="text-[12px] text-[var(--mg-muted)]">この文書は空です。</p>;
  }

  const spot = anchor.state === "unknown" ? -1 : anchor.index;
  const maybe = anchor.state === "unknown" ? anchor.candidates : [];
  const scrollTo = spot >= 0 ? spot : (maybe[0] ?? -1);
  const shown = blocks.slice(0, limit);

  return (
    <div className="mg-doc">
      {shown.map((block, i) => {
        const isSpot = i === spot;
        const rank = maybe.indexOf(i);
        return (
          <div
            key={block.index}
            ref={i === scrollTo ? targetRef : undefined}
            className={i === scrollTo ? "mg-anchor" : undefined}
          >
            {isSpot && anchor.state === "removed" && (
              <Gone src={anchor.before} editorial={editorial} style={style} />
            )}
            {isSpot && anchor.state === "rewritten" && (
              <div className="mg-before">
                <div className="mg-before-label">指摘した時点</div>
                <div className="mg-prose prose" style={style}>
                  <Markdown body={anchor.before} editorial={editorial} />
                </div>
              </div>
            )}
            <div
              data-label={
                isSpot && anchor.state !== "removed"
                  ? SPOT_LABEL[anchor.state]
                  : rank >= 0
                    ? `このあたり ${rank + 1}`
                    : undefined
              }
              className={
                isSpot && anchor.state !== "removed"
                  ? "mg-spot"
                  : rank >= 0
                    ? "mg-maybe"
                    : "mg-plain"
              }
            >
              <div className="mg-prose prose" style={style}>
                <Markdown body={block.src} editorial={editorial} />
              </div>
            </div>
          </div>
        );
      })}

      {/* 末尾のブロックが消えていた場合は、続くブロックが無いのでここに出す */}
      {anchor.state === "removed" && spot >= blocks.length && (
        <div ref={targetRef} className="mg-anchor">
          <Gone src={anchor.before} editorial={editorial} style={style} />
        </div>
      )}

      {limit < blocks.length && (
        <p className="py-2 text-[11.5px] text-[var(--mg-muted)]">
          残り {blocks.length - limit} ブロックを読み込んでいます…
        </p>
      )}
    </div>
  );
}

// 指摘の箇所が今の本文から消えているとき、そこに在ったものを出す。
function Gone({
  src,
  editorial,
  style,
}: {
  src: string;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  return (
    <div className="mg-spot mg-spot-gone" data-label="ここに在った">
      <div className="mg-prose prose" style={style}>
        <Markdown body={src} editorial={editorial} />
      </div>
    </div>
  );
}
