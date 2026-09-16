import { useCallback, useEffect, useRef, useState } from "react";
import type { Block } from "../../lib/blocks";
import { applyDiffMarks } from "../../lib/diffMarks";
import { readBlockText, rangeAt } from "../../lib/domText";
import { findPlain, findPlainLoose } from "../../lib/projection";
import {
  SPOT_ICON,
  SPOT_NAME,
  type Change,
  type SpotDiff,
  type SpotState,
} from "../../lib/spotDiff";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

// 指摘が付いた文書を、現在の姿のまま出す。
//
// 版どうしの差分をまるごと並べていた頃は、指摘と関係のない書き換えが延々と
// 続いて何を見ればいいのか分からなかった。読み手が知りたいのは「指摘の箇所が
// 今どうなっているか」の一点なので、前後を見せるのはそこだけにする。
//
// 書き換わっていたら、その一点だけをコメント時点と今の 2 段で並べ、変わった字に
// 印を付ける（applyDiffMarks）。どの語が消えてどの語が入ったかまで出せる。
//
// 全ブロックを 1 回のペイントで描くと大きなファイルで固まるので、
// 本文と同じく先頭から順に足していく。

// 選ばれていた文字列に付ける印の名前。描画側は ::highlight() で拾う。
const MARK = "mg-review-selection";

// 最初の一塊は小さく取る。ここを大きくすると、指摘を選んでから何かが
// 出るまでの間がそのまま伸びる。
const FIRST_CHUNK = 8;
// 残りを足す 1 回分。小さく刻むと、そのたびに一覧全体の突き合わせが走るので
// かえって遅い。対象へ着いたあとの穴埋めなので、大きく取る。
const NEXT_CHUNK = 160;

export function DocumentView({
  spot,
  changes,
  answered,
  blocks,
  editorial,
  style,
  focusNonce,
  goTo,
  onSettled,
  selection,
}: {
  blocks: Block[];
  // 指摘の箇所が今どうなっているか。版との突き合わせで出したもの。
  spot: SpotDiff;
  // 指摘の箇所の外で動いた所。コメントへの対応は、指摘された塊の外で
  // 行われることがある（節を足す、他の段落と言い回しを揃える）。
  changes: Change[];
  // 動いた分が「その対応そのもの」と言い切れるか（対応の記録が今の本文と同じ）。
  answered: boolean;
  // 押すたびに、この番号の塊へ寄せる。
  goTo: { at: number; nonce: number } | null;
  editorial: boolean;
  style: React.CSSProperties;
  // 増えるたびに指摘の箇所へ戻す。読み進めて見失ったときのための合図。
  focusNonce: number;
  // 指摘のときに選ばれていた文字列。ブロックの中のどこかを示すのに使う。
  selection: string;
  // 対象の箇所を描いて、そこへ寄せ終わったときに 1 度だけ呼ぶ。
  // 読み込み中の表示を、移動が済むまで出しておくために使う。
  onSettled?: () => void;
}) {
  const [limit, setLimit] = useState(FIRST_CHUNK);
  const root = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  // 選ばれていた文字列そのものに印を付けられたときの、その位置
  const markRef = useRef<HTMLElement | null>(null);
  const [marked, setMarked] = useState(false);
  // 自分でスクロールしたら、そこから先は勝手に動かさない
  const touchedRef = useRef(false);
  // 対象へ寄せ終わったことを 1 度だけ知らせる
  const settledRef = useRef(false);

  // 印まで絞れているときはそこへ、絞れていなければブロックの頭へ寄せる。
  const focus = useCallback((behavior: ScrollBehavior) => {
    const mark = markRef.current;
    if (mark) mark.scrollIntoView({ block: "center", behavior });
    else targetRef.current?.scrollIntoView({ block: "start", behavior });
  }, []);

  // 寄せ先。effect より前で決める（下の描画と、寄せ終わりの判定の両方で使う）。
  // 決められなかった指摘には寄せ先が無い（近そうな塊へは寄せない）。
  const at = spot.state === "unknown" ? -1 : spot.index;
  // コメント時点と並べて出す状態。箇所が今の本文に残っているものだけ。
  const paired =
    (spot.state === "rewritten" || spot.state === "around") && spot.before !== null;

  // 何を見ているかは中身で表す。配列やオブジェクトの同一性で見張ると、
  // 中身が同じでも作り直されるたびに先頭へ巻き戻ってしまう。
  const total = blocks.length;
  const spotKey = `${spot.state}:${spot.index}`;

  // 最初の描画に対象を含める。ブロックの位置は前にあるものの高さで決まるので、
  // 対象へ寄せるには結局そこまで描くしかない。先頭から少しずつ足していくと、
  // 対象が後半にあるほど到達が遅れ、待ち時間がそのぶん伸びる。1 回で描き切る。
  const opening = Math.min(total, Math.max(FIRST_CHUNK, at + 1 + FIRST_CHUNK));

  // 残りは後から足す。始めから終わりまでを 1 つの effect が持つ。
  // 「足す」と「先頭に戻す」を別々の effect に分けると、片方が進めた直後に
  // もう片方が戻す並びが起こり得て、いつまでも先へ進まない。
  useEffect(() => {
    touchedRef.current = false;
    settledRef.current = false;
    setLimit(opening);
    if (total <= opening) return;
    let shownCount = opening;
    let frame = requestAnimationFrame(function step() {
      shownCount = Math.min(shownCount + NEXT_CHUNK, total);
      setLimit(shownCount);
      if (shownCount < total) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [total, spotKey, opening]);

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

  // コメント時点と今の組で、変わった字に印を付ける。中身は表にもなるので、
  // バージョンの画面と同じ道を通す。箇所の外で動いた塊の組も、ここで一緒に見る。
  useEffect(
    () => applyDiffMarks(root.current),
    [paired, spotKey, changes, limit, editorial, style],
  );

  // 選ばれていた文字列そのものに印を付ける。表のように大きなブロックでは、
  // ブロック全体を塗っても「どのセルの話か」が分からない。
  // 本文の DOM は書き換えず、範囲だけを描画側に渡す。
  useEffect(() => {
    const registry = "highlights" in CSS ? CSS.highlights : null;
    const block = targetRef.current;
    markRef.current = null;
    setMarked(false);
    if (!registry) return;
    registry.delete(MARK);
    const needle = selection.trim();
    if (!block || !needle) return;
    const text = readBlockText(block);
    const hit = findPlain(text.plain, needle) ?? findPlainLoose(text.plain, needle);
    if (!hit) return;
    const range = rangeAt(text, hit.start, hit.end);
    if (!range) return;
    registry.set(MARK, new Highlight(range));
    markRef.current =
      range.startContainer.parentElement instanceof HTMLElement
        ? range.startContainer.parentElement
        : null;
    setMarked(true);
    return () => {
      registry.delete(MARK);
    };
  }, [selection, limit, spotKey]);

  // 描き足すたびに位置を合わせ直す。上にある画像や数式が遅れて入ると
  // 対象が押し下げられるため、1 回きりだと狙った場所からずれる。
  // 上の余白は CSS の scroll-margin-top（.mg-anchor）で取る。
  useEffect(() => {
    if (touchedRef.current) return;
    focus("auto");
    // 対象がまだ描かれていないうちに知らせると、移動前に読み込み中の表示が
    // 消えてしまう。描かれた回で初めて知らせる。対象が無いときは待たせない。
    if (settledRef.current) return;
    if (at < 0 || limit > at) {
      settledRef.current = true;
      onSettled?.();
    }
  }, [limit, spotKey, marked, focus, at, onSettled]);

  // 頼まれたら戻す。自分でスクロールしていても、このときだけは動かす。
  useEffect(() => {
    if (focusNonce === 0) return;
    touchedRef.current = true; // 戻したあとは、また自由にスクロールできる
    focus("smooth");
  }, [focusNonce, focus]);

  // 「次の変更へ」。指摘の箇所の外で動いた所を順に見せる。
  useEffect(() => {
    if (!goTo) return;
    touchedRef.current = true;
    root.current
      ?.querySelector(`[data-mg-at="${goTo.at}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [goTo]);

  if (blocks.length === 0) {
    return <p className="text-[12px] text-[var(--mg-muted)]">この文書は空です。</p>;
  }

  const shown = blocks.slice(0, limit);
  // 塊ごとの、指摘の箇所の外の動き。消えた塊は同じ番号に複数並び得る。
  const moved = new Map<number, Change>();
  const dropped = new Map<number, Change[]>();
  for (const change of changes) {
    if (change.index === at) continue; // 箇所そのものは上の組で出している
    if (change.kind === "removed") {
      dropped.set(change.index, [...(dropped.get(change.index) ?? []), change]);
    } else {
      moved.set(change.index, change);
    }
  }

  return (
    <div ref={root} className="mg-doc">
      {shown.map((block, i) => {
        const gone = i === at && spot.state === "removed";
        const isSpot = i === at && !gone;
        // 寄せる先は目印そのもの。組の外側に付けると、コメント時点の段が
        // 長いときに今の本文が画面の下へ押し出されてしまう。
        const isTarget = i === at;
        const now = (
          <div className={`mg-prose prose ${editorial ? "mg-editorial" : ""}`} style={style}>
            <Markdown body={block.src} editorial={editorial} />
          </div>
        );
        if (isSpot && paired && spot.before !== null) {
          return (
            <div key={block.index} className="mg-spot-pair" data-diff-pair="">
              <Tag state={spot.state} added={spot.added} removed={spot.removed} />
              <section className="mg-spot-side is-base">
                <header className="mg-spot-side-head">
                  <Icon name="remove" size={13} />
                  コメント時点
                </header>
                <div data-diff-side="base">
                  <div
                    className={`mg-prose prose ${editorial ? "mg-editorial" : ""}`}
                    style={style}
                  >
                    <Markdown body={spot.before} editorial={editorial} />
                  </div>
                </div>
              </section>
              <section className="mg-spot-side is-head">
                <header className="mg-spot-side-head">
                  <Icon name="add" size={13} />今
                </header>
                {/* 選んだ字がどのブロックかを引く目印。本文の画面と同じ名前で
                    持つので、コメントを書く仕組みがそのまま乗る。コメント時点の
                    字（上の段）には付けない。 */}
                <div
                  ref={isTarget ? targetRef : undefined}
                  data-diff-side="head"
                  data-mg-block={block.index}
                  className={`mg-spot-now${isTarget ? " mg-anchor" : ""}`}
                >
                  {now}
                </div>
              </section>
            </div>
          );
        }
        const change = isSpot ? undefined : moved.get(i);
        return (
          <div key={block.index} data-mg-at={i} data-diff-pair={change ? "" : undefined}>
            {gone && (
              <div
                ref={isTarget ? targetRef : undefined}
                className={isTarget ? "mg-anchor" : undefined}
              >
                <Tag state={spot.state} added={0} removed={spot.removed} />
                <Gone src={spot.before ?? ""} editorial={editorial} style={style} />
              </div>
            )}
            {(dropped.get(i) ?? []).map((c, n) => (
              <Dropped
                key={n}
                src={c.before ?? ""}
                answered={answered}
                editorial={editorial}
                style={style}
              />
            ))}
            {isSpot && <Tag state={spot.state} added={0} removed={0} />}
            {change && <ChangeHead kind={change.kind} answered={answered} />}
            {change && change.before !== null && (
              <section className="mg-change-side is-base">
                <header className="mg-spot-side-head">
                  <Icon name="remove" size={13} />
                  コメント時点
                </header>
                <div data-diff-side="base">
                  <div
                    className={`mg-prose prose ${editorial ? "mg-editorial" : ""}`}
                    style={style}
                  >
                    <Markdown body={change.before} editorial={editorial} />
                  </div>
                </div>
              </section>
            )}
            <div
              ref={isTarget && !gone ? targetRef : undefined}
              // 選んだ字がどのブロックかを引く目印。
              data-mg-block={block.index}
              data-diff-side={change ? "head" : undefined}
              className={`${isSpot ? "mg-spot" : "mg-plain"}${
                isTarget && !gone ? " mg-anchor" : ""
              }${
                // 選ばれていた文字列まで絞れたときは、ブロック全体の地色を弱める
                isSpot && marked ? " is-narrow" : ""
              }${change ? " mg-change-side is-head" : ""}`}
            >
              {now}
            </div>
          </div>
        );
      })}

      {/* 末尾のブロックが消えていた場合は、続くブロックが無いのでここに出す */}
      {spot.state === "removed" && at >= blocks.length && (
        <div ref={targetRef} className="mg-anchor">
          <Tag state={spot.state} added={0} removed={spot.removed} />
          <Gone src={spot.before ?? ""} editorial={editorial} style={style} />
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

// 何が起きたかの見出し。面の上に 1 行で置く。
//
// 面の上端に貼り付く丸い札にしていた頃は、すぐ下の「コメント時点」と二重になって、
// 小さい面の中で 2 つのラベルがぶつかっていた。見出しは 1 つに絞り、増減の字数も
// ここへ寄せる（同じことを 2 か所で言わない）。
function Tag({
  state,
  added,
  removed,
}: {
  state: SpotState;
  added: number;
  removed: number;
}) {
  return (
    <header className={`mg-spot-tag is-${state}`}>
      <Icon name={SPOT_ICON[state]} size={13} fill />
      {SPOT_NAME[state]}
      {(added > 0 || removed > 0) && (
        <span className="mg-spot-delta">
          {removed > 0 && <span className="is-del">−{removed}</span>}
          {added > 0 && <span className="is-add">＋{added}</span>}
        </span>
      )}
    </header>
  );
}

// 指摘の箇所の外で動いた塊の見出し。本文の読み心地を壊さないよう、線 1 本と
// 短い語だけにして、見比べたいときに開く。
function ChangeHead({ kind, answered }: { kind: Change["kind"]; answered: boolean }) {
  return (
    <header className="mg-change-head">
      <Icon name={kind === "added" ? "add" : "difference"} size={12} />
      {answered ? "この対応で" : "コメント時点から"}
      {kind === "added" ? "足された" : kind === "removed" ? "消えた" : "変わった"}
    </header>
  );
}

// 指摘の箇所の外で消えた塊。今の本文に相手が居ないので、そこに在ったものを出す。
function Dropped({
  src,
  answered,
  editorial,
  style,
}: {
  src: string;
  answered: boolean;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  return (
    <>
      <ChangeHead kind="removed" answered={answered} />
      <div className="mg-change-side is-base mg-spot-gone">
        <div className={`mg-prose prose ${editorial ? "mg-editorial" : ""}`} style={style}>
          <Markdown body={src} editorial={editorial} />
        </div>
      </div>
    </>
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
    <div className="mg-spot mg-spot-gone">
      <div className={`mg-prose prose ${editorial ? "mg-editorial" : ""}`} style={style}>
        <Markdown body={src} editorial={editorial} />
      </div>
    </div>
  );
}
