import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  blocksOf,
  isTableBlock,
  itemMarkerAt,
  listItemAt,
  replaceBlock,
  toggleTaskAt,
  toggleTaskNth,
} from "../lib/blocks";
import { anchorAt, type Section } from "../lib/anchors";
import { blockIndexOf, blockRect, topmostBlock } from "../lib/domText";
import { setCalloutColor, setCalloutIcon } from "../lib/htmlBlocks";
import { BlockGutter } from "./BlockGutter";
import { CalloutIcon } from "./CalloutIcon";
import { Markdown } from "./Markdown";

// 漸進描画の粒度。最初のひと塊は 1 画面を埋める程度、以降はフレームごとに足す。
const FIRST_CHUNK = 24;
const NEXT_CHUNK = 40;

// 編集の後、スクロール位置を押さえ続けるフレーム数。
const HOLD_FRAMES = 5;

// 読む面の本文。ブロックごとに描き、つまみと指摘の入口を重ねる。
// 書き換えるのはタスクのチェックとコールアウトのアイコン・色だけで、ほかの
// 編集はリアルタイム編集の面でやる。
export const EditableBody = memo(function EditableBody({
  body,
  editorial,
  onSaveBody,
  startIndex,
  content,
  scroller,
  contentKey,
  onComment,
  onCopyLink,
  onCommentItem,
  onCommentCell,
}: {
  body: string;
  editorial: boolean;
  onSaveBody: (newBody: string) => void;
  // つまみを重ねる先と、位置を据え置くためのスクロール枠。
  content?: HTMLElement | null;
  scroller?: HTMLElement | null;
  contentKey?: string;
  // ブロック全体への指摘。選択の付け替えが要るので呼び出し側で行う。
  onComment?: (index: number) => void;
  // その塗を指すリンクを写す。行き先（節）はここで出し、道筋の組み立てと
  // 写しは呼び出し側が持つ。
  onCopyLink?: (section: Section | null) => void;
  // 箇条書きの項目への指摘。目印は描画側が持っているソースオフセット。
  onCommentItem?: (index: number, anchor: number) => void;
  // 表のセルへの指摘。目印はセルの中身が始まるソース上の位置。
  onCommentCell?: (index: number, cellStart: number) => void;
  // 最初の描画で、ここまでのブロックは一度に出す。復帰したときに見ていた
  // 場所を合わせるには、その手前までが組まれている必要がある。
  startIndex?: number;
}) {
  // ブロック割り。指摘を読む側と同じものを使う（割り方が食い違うと、指摘が
  // 別のブロックを指す）。全文 parse は 65,000 字で 200ms 超かかるので、
  // 中では書き換わった周りだけ parse し直している。
  const blocks = useMemo(() => blocksOf(body), [body]);

  // 本文は先頭から順に描画する。全ブロックを 1 回のペイントで描くと、
  // 400 ブロックのファイルで初回描画に 900ms 以上かかって固まって見えるため、
  // 最初のひと塊だけ即座に出し、残りはフレームごとに足していく。
  // limit は初期値のみ（DocPane がファイルごとに key で貼り替える）。編集で
  // body が変わっても描き直しにはならない。
  const [limit, setLimit] = useState(
    () => Math.max(0, startIndex ?? 0) + FIRST_CHUNK,
  );
  useEffect(() => {
    if (limit >= blocks.length) {
      // 一度出し切ったら上限を外す。ブロック数ちょうどで止めると、編集で
      // 1 つ増えた瞬間に末尾が消えて本文の高さが縮む。
      if (limit !== Infinity) setLimit(Infinity);
      return;
    }
    const id = requestAnimationFrame(() => {
      // 低優先度で足すことで、この間の入力やスクロールを妨げない
      startTransition(() =>
        setLimit((l) => Math.min(l + NEXT_CHUNK, blocks.length)),
      );
    });
    return () => cancelAnimationFrame(id);
  }, [limit, blocks.length]);
  const shown = limit >= blocks.length ? blocks : blocks.slice(0, limit);
  // その場の書き換えではブロックの番号が動かない。
  const keep = (i: number) => i;

  // 変更の前に、画面の上端に一番近いブロックの位置を控える。変更後に同じ見た目の
  // 位置へ戻すためのもの。remap は「そのブロックの番号が変更でどこへ移るか」。
  const anchorRef = useRef<{ index: number; top: number } | null>(null);

  // 変更の前に、いま画面の上端にあるブロックの位置を控える。
  const holdView = useCallback(
    (remap: (i: number) => number) => {
      if (!content || !scroller) return;
      const el = topmostBlock(content, scroller.getBoundingClientRect().top);
      const box = el ? blockRect(el) : null;
      const at = el ? blockIndexOf(el) : null;
      if (box && at !== null) {
        anchorRef.current = { index: remap(at), top: box.top };
      }
    },
    [content, scroller],
  );

  const apply = useCallback(
    (next: string, remap: (i: number) => number) => {
      if (next === body) return;
      holdView(remap);
      onSaveBody(next);
    },
    [body, holdView, onSaveBody],
  );

  // 恒久的に同じ関数から最新の状態を読むための控え。描画のたびに別関数を
  // 配ると、memo 済みの Markdown が 1 つも止まらず全ブロック描き直しになる。
  const latest = useRef({ blocks, body, apply });
  latest.current = { blocks, body, apply };

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor || !content || !scroller) return;
    // 高さが落ち着くまで数フレーム押さえる。1 回だけ直しても、その後に
    // 高さが動くとブラウザ側で位置が切り詰められて上へずれる。
    let left = HOLD_FRAMES;
    let raf = 0;
    const hold = () => {
      const el = content.querySelector<HTMLElement>(
        `[data-mg-block="${anchor.index}"]`,
      );
      const box = el ? blockRect(el) : null;
      if (box) {
        const delta = box.top - anchor.top;
        if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
      }
      if (--left > 0) raf = requestAnimationFrame(hold);
    };
    hold();
    raf = requestAnimationFrame(hold);
    return () => cancelAnimationFrame(raf);
  }, [body, content, scroller]);

  // 押されたタスクの [ ]↔[x] を入れ替えて保存。どのブロックのどの項目かは、
  // 押されたボタンから辿る。番号を渡す形にすると、ブロックを 1 つ消しただけで
  // 以降の番号がずれ、全部が描き直しになる。
  const toggleTask = useCallback((ordinal: number, el: HTMLElement) => {
    const wrap = el.closest<HTMLElement>("[data-mg-block]");
    const at = wrap ? Number(wrap.dataset.mgBlock) : NaN;
    const { blocks, body, apply } = latest.current;
    const block = Number.isInteger(at) ? blocks[at] : undefined;
    if (!block) return;
    // 項目に載っている原文の位置で書き換える行を決める。上から数える形だと、
    // 描かれない "- [ ] "（コード例の中の行など）を 1 つ数えた時点で以降が
    // まとめてずれる。
    const item = el.closest<HTMLElement>("[data-mg-item]");
    const anchor = item ? Number(item.dataset.mgItem) : NaN;
    // 位置が載らないのは、生 HTML の囲みを開いて描いたブロックだけ。原文と
    // 描いたものの文字数が合わないので、そこは従来どおり上から数える。
    const next = Number.isInteger(anchor)
      ? toggleTaskAt(block.src, anchor)
      : toggleTaskNth(block.src, ordinal);
    if (next === null) return;
    apply(replaceBlock(body, block, next), keep);
  }, []);

  // 表そのもののブロックか。表のつまみは表の左上の外に置く。
  const isTable = useCallback(
    (index: number) => {
      const block = blocks[index];
      return !!block && isTableBlock(block.src);
    },
    [blocks],
  );

  // ---- 箇条書きの項目 ----
  // Markdown ではリスト全体が 1 ブロックだが、指す単位は項目に合わせる。
  const itemAt = useCallback(
    (index: number, offset: number) => {
      const block = blocks[index];
      if (!block) return null;
      const item = listItemAt(block.src, offset);
      return item ? { from: item.from, to: item.to } : null;
    },
    [blocks],
  );

  const commentItem = useCallback(
    (index: number, at: number) => {
      const block = blocks[index];
      if (!block) return;
      const anchor = itemMarkerAt(block.src, at);
      if (anchor === null) return;
      onCommentItem?.(index, anchor);
    },
    [blocks, onCommentItem],
  );

  // コールアウトのアイコンと背景色を選び直す。開きタグの属性だけが変わる。
  const pickIcon = useCallback(
    (index: number, icon: string) => {
      const block = blocks[index];
      if (!block) return;
      const next = setCalloutIcon(block.src, icon);
      if (next === block.src) return;
      apply(replaceBlock(body, block, next), keep);
    },
    [blocks, body, apply],
  );

  const pickColor = useCallback(
    (index: number, color: string) => {
      const block = blocks[index];
      if (!block) return;
      const next = setCalloutColor(block.src, color);
      if (next === block.src) return;
      apply(replaceBlock(body, block, next), keep);
    },
    [blocks, body, apply],
  );

  // 内容ベースの安定 key。ブロックの追加/削除で index がずれても、内容が
  // 変わらないブロックは同じ key を保ち再マウントしない（削除時のちらつき防止）。
  const seen = new Map<string, number>();
  const keyOf = (src: string) => {
    const n = seen.get(src) ?? 0;
    seen.set(src, n + 1);
    return `${n}:${src}`;
  };

  const rows = shown.map((b) => (
    // display:contents で余白（prose の縦リズム）を崩さずに、
    // 選択やホバーの拾い先だけを作る。
    <div
      key={keyOf(b.src)}
      className="mg-block"
      // 選択範囲からどのブロックかを辿るための目印。display:contents でも
      // 属性は残るので、キーボードでの選択でもブロックを特定できる。
      data-mg-block={b.index}
    >
      <Markdown body={b.src} editorial={editorial} onToggleTask={toggleTask} />
    </div>
  ));

  return (
    <>
      {rows}
      <BlockGutter
        content={content ?? null}
        scroller={scroller ?? null}
        contentKey={contentKey ?? ""}
        isTable={isTable}
        onComment={(index) => onComment?.(index)}
        onCopyLink={(index) => onCopyLink?.(anchorAt(blocks, index))}
        onItemComment={commentItem}
        onCellComment={(index, at) => onCommentCell?.(index, at)}
        itemAt={itemAt}
      />
      <CalloutIcon
        content={content ?? null}
        contentKey={contentKey ?? ""}
        onPick={pickIcon}
        onColor={pickColor}
      />
    </>
  );
});
