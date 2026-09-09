import { useMemo, useState } from "react";
import type { Block } from "../../lib/blocks";
import { compare, unchanged, type DiffRow } from "../../lib/versions";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

// 版と版の差分。閲覧専用。
//
// 行ではなくブロックで突き合わせる。散文は 1 段落がソースの 1 行なので、
// 行差分では「段落全体が変わった」しか分からない。ブロックなら変更前と
// 変更後をそれぞれ描いて並べられる。
//
// 変わっていないところは畳む。同じものが延々と続くと、どこが変わったのかを
// 目で探すことになる。

export type Layout = "unified" | "split";

const SIDE_LABEL: Record<"base" | "head", string> = {
  base: "前",
  head: "後",
};

export function VersionDiff({
  base,
  head,
  layout,
  editorial,
  style,
}: {
  base: string;
  head: string;
  layout: Layout;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  const rows = useMemo(() => compare(base, head), [base, head]);

  if (unchanged(rows)) {
    return (
      <p className="mg-ver-note-line">
        <Icon name="check" size={15} />
        本文は同じです。
      </p>
    );
  }

  return (
    <div className={`mg-ver-diff is-${layout}`}>
      {rows.map((row, i) => (
        <Row
          key={i}
          row={row}
          layout={layout}
          editorial={editorial}
          style={style}
        />
      ))}
    </div>
  );
}

function Row({
  row,
  layout,
  editorial,
  style,
}: {
  row: DiffRow;
  layout: Layout;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);

  if (row.kind === "gap") {
    if (!open) {
      return (
        <button className="mg-ver-gap" onClick={() => setOpen(true)}>
          <Icon name="unfold_more" size={14} />
          変わっていない {row.blocks.length} ブロック
        </button>
      );
    }
    return (
      <>
        <button className="mg-ver-gap is-open" onClick={() => setOpen(false)}>
          <Icon name="unfold_less" size={14} />
          畳む
        </button>
        {row.blocks.map((block) => (
          <Kept key={block.index} block={block} editorial={editorial} style={style} />
        ))}
      </>
    );
  }

  if (row.kind === "kept") {
    return <Kept block={row.block} editorial={editorial} style={style} />;
  }

  // フロントマターは本文のブロックに割れないので、書いたままの形で並べる。
  if (row.kind === "meta") {
    return (
      <Pair
        layout={layout}
        base={<pre className="mg-ver-meta">{row.base.trim()}</pre>}
        head={<pre className="mg-ver-meta">{row.head.trim()}</pre>}
        label="見出し情報"
      />
    );
  }

  const before =
    "base" in row ? (
      <Prose src={row.base.src} editorial={editorial} style={style} />
    ) : null;
  const after =
    "head" in row ? (
      <Prose src={row.head.src} editorial={editorial} style={style} />
    ) : null;
  const label =
    row.kind === "changed" ? "書き換え" : row.kind === "added" ? "追加" : "削除";

  return <Pair layout={layout} base={before} head={after} label={label} />;
}

// 変わっていないブロック。地色を付けず、周りの文脈として置く。
function Kept({
  block,
  editorial,
  style,
}: {
  block: Block;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  return (
    <div className="mg-ver-kept">
      <Prose src={block.src} editorial={editorial} style={style} />
    </div>
  );
}

// 前と後。統合なら縦に重ね、分割なら左右に置く。
//
// 分割では grid の 1 行に 2 つのセルを入れる。行の高さは高いほうに揃うので、
// ブロック単位で描いたまま左右が並ぶ。
function Pair({
  layout,
  base,
  head,
  label,
}: {
  layout: Layout;
  base: React.ReactNode;
  head: React.ReactNode;
  label: string;
}) {
  return (
    <div className="mg-ver-pair" data-label={label}>
      {base && (
        <div className="mg-ver-cell is-base" data-side={SIDE_LABEL.base}>
          {base}
        </div>
      )}
      {/* 分割では、片側だけの行でも列が崩れないように空のセルを置く */}
      {!base && layout === "split" && <div className="mg-ver-cell is-void" />}
      {head && (
        <div className="mg-ver-cell is-head" data-side={SIDE_LABEL.head}>
          {head}
        </div>
      )}
      {!head && layout === "split" && <div className="mg-ver-cell is-void" />}
    </div>
  );
}

function Prose({
  src,
  editorial,
  style,
}: {
  src: string;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  return (
    <div className={`mg-prose prose ${editorial ? "mg-editorial" : ""}`} style={style}>
      <Markdown body={src} editorial={editorial} />
    </div>
  );
}
