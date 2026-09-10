import { useMemo } from "react";
import { charDiff, type Span } from "../../lib/charDiff";
import {
  splitRows,
  type DiffLine,
  type Hunk,
  type LineDiff,
} from "../../lib/lineDiff";
import type { Layout } from "./VersionDiff";

// Markdown のソースを、書いたままの形で比べる。
//
// 組版を通した比較では、記法の違い（見出しの階層、表の区切り、リンクの
// 書き方）が読み取れない。ソースで比べる面は、そこを見るためにある。
// 見せ方は行差分の作法にそのまま倣う。

export function SourceDiff({ diff, layout }: { diff: LineDiff; layout: Layout }) {
  if (diff.hunks.length === 0) {
    return <p className="mg-ver-note-line">ソースは同じです。</p>;
  }

  return (
    <div className="mg-src">
      {diff.hunks.map((hunk, i) => (
        <section key={i} className="mg-src-hunk" data-mg-change="">
          <div className="mg-src-at">
            @@ −{hunk.a},{hunk.aCount} ＋{hunk.b},{hunk.bCount} @@
          </div>
          {layout === "split" ? (
            <Split hunk={hunk} />
          ) : (
            <Unified hunk={hunk} />
          )}
        </section>
      ))}
    </div>
  );
}

function Unified({ hunk }: { hunk: Hunk }) {
  const marks = useMarks(hunk.lines);
  return (
    <div className="mg-src-rows">
      {hunk.lines.map((line, i) => (
        <div key={i} className={`mg-src-row is-${line.kind}`}>
          <span className="mg-src-no">{line.a ?? ""}</span>
          <span className="mg-src-no">{line.b ?? ""}</span>
          <span className="mg-src-sign">{SIGN[line.kind]}</span>
          <span className="mg-src-text">
            <Marked text={line.text} spans={marks.get(line)} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Split({ hunk }: { hunk: Hunk }) {
  const marks = useMarks(hunk.lines);
  const rows = useMemo(() => splitRows(hunk.lines), [hunk]);
  return (
    <div className="mg-src-rows is-split">
      {rows.map((row, i) => (
        <div key={i} className="mg-src-pair">
          <Cell line={row.left} side="a" marks={marks} />
          <Cell line={row.right} side="b" marks={marks} />
        </div>
      ))}
    </div>
  );
}

function Cell({
  line,
  side,
  marks,
}: {
  line: DiffLine | null;
  side: "a" | "b";
  marks: Map<DiffLine, Span[]>;
}) {
  if (!line) return <div className="mg-src-row is-void" />;
  return (
    <div className={`mg-src-row is-${line.kind}`}>
      <span className="mg-src-no">{line[side] ?? ""}</span>
      <span className="mg-src-sign">{SIGN[line.kind]}</span>
      <span className="mg-src-text">
        <Marked text={line.text} spans={marks.get(line)} />
      </span>
    </div>
  );
}

const SIGN: Record<DiffLine["kind"], string> = {
  same: " ",
  add: "＋",
  del: "−",
};

// 書き換えの組になっている行から、行内のどこが変わったかを求める。
// 行そのものを鍵にするので、統合と分割で同じ結果を引ける。
function useMarks(lines: DiffLine[]): Map<DiffLine, Span[]> {
  return useMemo(() => {
    const marks = new Map<DiffLine, Span[]>();
    const byPair = new Map<number, DiffLine[]>();
    for (const line of lines) {
      if (line.pair === undefined) continue;
      const group = byPair.get(line.pair) ?? [];
      group.push(line);
      byPair.set(line.pair, group);
    }
    for (const group of byPair.values()) {
      const dels = group.filter((l) => l.kind === "del");
      const adds = group.filter((l) => l.kind === "add");
      // 出てきた順に 1 対 1 で見る。片側だけ余った行は行ごと変わったもの。
      for (let i = 0; i < Math.min(dels.length, adds.length); i++) {
        const d = charDiff(dels[i].text, adds[i].text);
        // 諦めたときは行ごと塗る（区間で示せることが無い）
        if (d.gaveUp) continue;
        marks.set(dels[i], d.del);
        marks.set(adds[i], d.ins);
      }
    }
    return marks;
  }, [lines]);
}

// 変わったところだけを立てる。素の文字なので、印はそのまま組める。
function Marked({ text, spans }: { text: string; spans: Span[] | undefined }) {
  if (!spans || spans.length === 0) return <>{text || " "}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.from > at) parts.push(text.slice(at, span.from));
    parts.push(
      <mark key={span.from} className="mg-src-mark">
        {text.slice(span.from, span.to)}
      </mark>,
    );
    at = span.to;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
