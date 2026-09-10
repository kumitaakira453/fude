import { useEffect, useMemo, useRef, useState } from "react";
import type { Block } from "../../lib/blocks";
import { charDiff } from "../../lib/charDiff";
import { rangeAt, readBlockText } from "../../lib/domText";
import { compare, unchanged, type DiffRow } from "../../lib/versions";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

// バージョンとバージョンの差分を、組版を通した姿で比べる。閲覧専用。
//
// 行ではなくブロックで突き合わせる。散文は 1 段落がソースの 1 行なので、
// 行差分では「段落全体が変わった」しか分からない。ブロックなら変更前と
// 変更後をそれぞれ描いて並べられる。
//
// 見立ては校正刷り。変更前は少し退けた濃さで置き、変更後を本文の濃さで読ませる。
// 枠で囲まず、左の罫と行頭の記号だけで区切る。

export type Layout = "unified" | "split";

// 印の名前。描画側は ::highlight() で拾う。
const DEL = "mg-diff-del";
const INS = "mg-diff-ins";

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
  const root = useRef<HTMLDivElement>(null);
  useInnerMarks(root, rows, layout, editorial, style);

  if (unchanged(rows)) {
    return (
      <p className="mg-ver-note-line">
        <Icon name="check" size={15} />
        本文は同じです。
      </p>
    );
  }

  return (
    <div ref={root} className="mg-ver-diff">
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

// 書き換わった組の中で、変わった字だけに印を付ける。
//
// 描画結果どうしを比べるので、見た目が変わらない記法の違いには印が付かない。
// 組版を通した比較としてはそれが正しい（記法を見たいときはソースで比べる）。
//
// DOM は書き換えず、範囲だけを描画側へ渡す。属性やタグを足すと Markdown の
// 木を組み直すことになり、大きな文書で目に見えて遅くなる。
function useInnerMarks(
  root: React.RefObject<HTMLDivElement | null>,
  rows: DiffRow[],
  layout: Layout,
  editorial: boolean,
  style: React.CSSProperties,
) {
  useEffect(() => {
    const registry = "highlights" in CSS ? CSS.highlights : null;
    if (!registry) return;
    registry.delete(DEL);
    registry.delete(INS);
    const el = root.current;
    if (!el) return;

    const dels: Range[] = [];
    const inss: Range[] = [];
    for (const pair of el.querySelectorAll<HTMLElement>(".mg-ver-pair")) {
      const a = pair.querySelector<HTMLElement>('[data-diff-side="base"]');
      const b = pair.querySelector<HTMLElement>('[data-diff-side="head"]');
      if (!a || !b) continue;
      const left = readBlockText(a);
      const right = readBlockText(b);
      const diff = charDiff(left.plain, right.plain);
      // 長すぎて突き合わせを諦めたときは、塊ごと変わったものとして扱う
      // （全部を塗ると、変わっていない字まで立ってしまう）。
      if (diff.gaveUp) continue;
      for (const span of diff.del) {
        const range = rangeAt(left, span.from, span.to);
        if (range) dels.push(range);
      }
      for (const span of diff.ins) {
        const range = rangeAt(right, span.from, span.to);
        if (range) inss.push(range);
      }
    }
    if (dels.length > 0) registry.set(DEL, new Highlight(...dels));
    if (inss.length > 0) registry.set(INS, new Highlight(...inss));

    return () => {
      registry.delete(DEL);
      registry.delete(INS);
    };
  }, [root, rows, layout, editorial, style]);
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
  const before =
    row.kind === "meta" ? (
      <pre className="mg-ver-meta">{row.base.trim()}</pre>
    ) : "base" in row ? (
      <Prose src={row.base.src} editorial={editorial} style={style} />
    ) : null;
  const after =
    row.kind === "meta" ? (
      <pre className="mg-ver-meta">{row.head.trim()}</pre>
    ) : "head" in row ? (
      <Prose src={row.head.src} editorial={editorial} style={style} />
    ) : null;

  return (
    <div className={`mg-ver-pair is-${layout}`} data-mg-change="">
      <Side kind="base" of={row.kind} body={before} layout={layout} />
      <Side kind="head" of={row.kind} body={after} layout={layout} />
    </div>
  );
}

const MARK = { base: "remove", head: "add" } as const;

// 何が起きたかは、片側だけの組では「追加」「削除」で言い切れる。
function labelOf(kind: "base" | "head", of: DiffRow["kind"]): string {
  if (of === "added") return "追加";
  if (of === "removed") return "削除";
  return kind === "base" ? "変更前" : "変更後";
}

// 変更前 / 変更後の片側。
//
// 色だけでは前後を言い分けられない（テーマによって danger とアクセントが
// 同系色になる）。記号と語を必ず添える。
//
// 片側しか無い組では、分割のときだけ「無い」ことを言う。統合では並べる相手が
// 無いので、言わなくても片側だけだと分かる。
function Side({
  kind,
  of,
  body,
  layout,
}: {
  kind: "base" | "head";
  of: DiffRow["kind"];
  body: React.ReactNode;
  layout: Layout;
}) {
  if (!body) {
    if (layout === "unified") return null;
    return (
      <div className="mg-ver-side is-void">
        <span>（このバージョンにはない）</span>
      </div>
    );
  }
  return (
    <div className={`mg-ver-side is-${kind}`}>
      <div className="mg-ver-side-head">
        <Icon name={MARK[kind]} size={13} />
        {labelOf(kind, of)}
      </div>
      <div data-diff-side={kind}>{body}</div>
    </div>
  );
}

// 変わっていないブロック。周りの文脈として置く。
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
