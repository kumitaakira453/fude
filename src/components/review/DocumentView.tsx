import { useEffect, useRef, useState } from "react";
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

// 最初の一塊は小さく取る。ここを大きくすると、指摘を選んでから何かが
// 出るまでの間がそのまま伸びる。
const FIRST_CHUNK = 8;
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
  focusNonce,
}: {
  blocks: Block[];
  anchor: Anchor;
  editorial: boolean;
  style: React.CSSProperties;
  // 増えるたびに指摘の箇所へ戻す。読み進めて見失ったときのための合図。
  focusNonce: number;
}) {
  const [limit, setLimit] = useState(FIRST_CHUNK);
  const targetRef = useRef<HTMLDivElement>(null);
  // 自分でスクロールしたら、そこから先は勝手に動かさない
  const touchedRef = useRef(false);

  // 何を見ているかは中身で表す。配列やオブジェクトの同一性で見張ると、
  // 中身が同じでも作り直されるたびに先頭へ巻き戻ってしまう。
  const total = blocks.length;
  const anchorKey =
    anchor.state === "unknown"
      ? `unknown:${anchor.candidates.join(",")}`
      : `${anchor.state}:${anchor.index}`;

  // 先頭から順に足していく。始めから終わりまでを 1 つの effect が持つ。
  // 「足す」と「先頭に戻す」を別々の effect に分けると、片方が進めた直後に
  // もう片方が戻す並びが起こり得て、いつまでも先へ進まない。
  useEffect(() => {
    touchedRef.current = false;
    setLimit(FIRST_CHUNK);
    if (total <= FIRST_CHUNK) return;
    let shownCount = FIRST_CHUNK;
    let frame = requestAnimationFrame(function step() {
      shownCount = Math.min(shownCount + NEXT_CHUNK, total);
      setLimit(shownCount);
      if (shownCount < total) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [total, anchorKey]);

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
  }, [limit, anchorKey]);

  // 頼まれたら戻す。自分でスクロールしていても、このときだけは動かす。
  useEffect(() => {
    if (focusNonce === 0) return;
    touchedRef.current = true; // 戻したあとは、また自由にスクロールできる
    targetRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusNonce]);

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
