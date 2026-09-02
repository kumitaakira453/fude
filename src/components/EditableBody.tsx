import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  appendTableColumn,
  appendTableRow,
  cellFromStart,
  cellStartAt,
  cellValueAt,
  cutSelection,
  clearTableColumn,
  clearTableRow,
  cutBlock,
  deleteTableColumn,
  deleteTableRow,
  deleteListItem,
  duplicateListItem,
  duplicateTableColumn,
  duplicateTableRow,
  insertAfter,
  insertBefore,
  insertListItem,
  insertTableColumn,
  insertTableRow,
  isMermaidBlock,
  isTableBlock,
  itemMarkerAt,
  itemTextRange,
  listItemAt,
  moveBlock,
  moveListItem,
  moveTableColumn,
  moveTableRow,
  remapAfterMove,
  replaceBlock,
  resplitBlocks,
  setCellValue,
  splitBlocks,
  splitRow,
  type Block,
} from "../lib/blocks";
import { blockIndexOf, blockRect, topmostBlock } from "../lib/domText";
import { setCalloutIcon } from "../lib/htmlBlocks";
import { BlockGutter, type Part, type TableAct } from "./BlockGutter";
import { CalloutIcon } from "./CalloutIcon";
import { BlockSourceEditor } from "./BlockSourceEditor";
import { Markdown } from "./Markdown";

// タスク行（- [ ] / 1. [x] など）
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

// 漸進描画の粒度。最初のひと塊は 1 画面を埋める程度、以降はフレームごとに足す。
const FIRST_CHUNK = 24;
const NEXT_CHUNK = 40;

// 編集の後、スクロール位置を押さえ続けるフレーム数。
const HOLD_FRAMES = 5;

// 行が持つセルの数。末尾に足した列の位置を出すのに使う。
const cellsInRow = (line: string) => {
  const parts = splitRow(line);
  const lead = /^\s*\|/.test(line) ? 1 : 0;
  const tail =
    parts.length > 1 && parts[parts.length - 1].trim() === "" ? 1 : 0;
  return parts.length - lead - tail;
};

interface EditingCell {
  blockIndex: number;
  cellStart: number;
  lineIndex: number;
  colIndex: number;
  value: string;
}

interface EditingItem {
  blockIndex: number;
  anchor: number;
  start: number;
  end: number;
  value: string;
}

// レンダリング表示を保ったまま、ダブルクリックしたブロックだけをその場で
// 生ソース編集にする。編集対象以外は一切動かない（目線を動かさない）。
export function EditableBody({
  body,
  editorial,
  onSaveBody,
  editRequest,
  deleteRequest,
  onDeleted,
  content,
  scroller,
  contentKey,
  onComment,
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
  // 外から編集を始める頼み。選択メニューの「編集する」が立てる。
  // nonce が変わるたびに読み直すので、同じ場所を続けて頼んでも効く。
  editRequest?: {
    path: string;
    blockIndex: number;
    cellStart?: number;
    itemAnchor?: number;
    nonce: number;
  } | null;
  // 選択したところを消す頼み。選択メニューと ⌫ / Delete が立てる。
  // 位置と文字は画面に出ているものなので、ソースのどこを切るかは受けた側で出す。
  deleteRequest?: {
    path: string;
    blockIndex: number;
    start: number;
    text: string;
    cellStart?: number;
    itemAnchor?: number;
    nonce: number;
  } | null;
  // 削除したときに、消す前の本文と知らせの文を渡す（取り消しに使う）。
  // 消せなかったときは本文を渡さない（戻すものが無い）。
  onDeleted?: (previousBody: string | null, text: string) => void;
}) {
  // ブロック割り。全文 parse は 65,000 字で 200ms 超かかるので、2 回目以降は
  // 直前の割り方を土台に、書き換わったところの周りだけ parse し直す。
  const split = useRef<{ body: string; blocks: Block[] } | null>(null);
  const blocks = useMemo(() => {
    const prev = split.current;
    const next = prev
      ? resplitBlocks(prev.body, prev.blocks, body)
      : splitBlocks(body);
    split.current = { body, blocks: next };
    return next;
  }, [body]);

  // 本文は先頭から順に描画する。全ブロックを 1 回のペイントで描くと、
  // 400 ブロックのファイルで初回描画に 900ms 以上かかって固まって見えるため、
  // 最初のひと塊だけ即座に出し、残りはフレームごとに足していく。
  // limit は初期値のみ（DocPane がファイルごとに key で貼り替える）。編集で
  // body が変わっても描き直しにはならない。
  const [limit, setLimit] = useState(FIRST_CHUNK);
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
  // 編集対象ブロックと、開始時のダブルクリック座標（カーソル配置に使う）
  // 座標はカーソルの初期位置に使う。選択メニューから開いたときは持たない。
  const [editing, setEditing] = useState<{
    index: number;
    x: number | null;
    y: number | null;
  } | null>(null);
  // 編集中のテーブルセル（ブロック全体ではなく 1 セルだけ）
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  // 編集中の箇条書き項目（リスト全体ではなく 1 項目の本文だけ）
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);

  // 差し込みの受け皿。確定するまで本文には書かない。
  const [pending, setPending] = useState<{
    index: number;
    side: "before" | "after";
  } | null>(null);

  // その場の書き換えではブロックの番号が動かない。
  const keep = (i: number) => i;

  // 変更の前に、画面の上端に一番近いブロックの位置を控える。変更後に同じ見た目の
  // 位置へ戻すためのもの。remap は「そのブロックの番号が変更でどこへ移るか」。
  const anchorRef = useRef<{ index: number; top: number } | null>(null);

  const apply = useCallback(
    (next: string, remap: (i: number) => number) => {
      if (next === body) return;
      if (content && scroller) {
        const el = topmostBlock(content, scroller.getBoundingClientRect().top);
        const box = el ? blockRect(el) : null;
        const at = el ? blockIndexOf(el) : null;
        if (box && at !== null) {
          anchorRef.current = { index: remap(at), top: box.top };
        }
      }
      onSaveBody(next);
    },
    [body, content, scroller, onSaveBody],
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

  const commitItem = useCallback(
    (v: string) => {
      if (!editingItem) return;
      const block = blocks[editingItem.blockIndex];
      setEditingItem(null);
      if (!block) return;
      const newSrc =
        block.src.slice(0, editingItem.start) +
        v +
        block.src.slice(editingItem.end);
      if (newSrc !== block.src) apply(replaceBlock(body, block, newSrc), keep);
    },
    [editingItem, blocks, body, apply],
  );

  const cancelItem = useCallback(() => setEditingItem(null), []);

  const commitCell = useCallback(
    (v: string) => {
      if (!editingCell) return;
      const block = blocks[editingCell.blockIndex];
      setEditingCell(null);
      if (!block) return;
      const newSrc = setCellValue(
        block.src,
        editingCell.lineIndex,
        editingCell.colIndex,
        v,
      );
      if (newSrc !== block.src) apply(replaceBlock(body, block, newSrc), keep);
    },
    [editingCell, blocks, body, apply],
  );

  const cancelCell = useCallback(() => setEditingCell(null), []);

  const commit = (index: number, newSrc: string) => {
    setEditing(null);
    const block = blocks[index];
    if (!block || newSrc === block.src) return;
    if (newSrc.trim() === "") {
      apply(cutBlock(body, block), (i) => (i > index ? i - 1 : i));
      return;
    }
    apply(replaceBlock(body, block, newSrc), keep);
  };

  // ブロック内 ordinal 番目のタスクの [ ]↔[x] をトグルして保存。
  // どのブロックかは押されたボタンから辿る。番号を渡す形にすると、
  // ブロックを 1 つ消しただけで以降の番号がずれ、全部が描き直しになる。
  const toggleTask = useCallback((ordinal: number, el: HTMLElement) => {
    const wrap = el.closest<HTMLElement>("[data-mg-block]");
    const at = wrap ? Number(wrap.dataset.mgBlock) : NaN;
    const { blocks, body, apply } = latest.current;
    const block = Number.isInteger(at) ? blocks[at] : undefined;
    if (!block) return;
    const lines = block.src.split("\n");
    let count = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!TASK_RE.test(lines[i])) continue;
      count++;
      if (count !== ordinal) continue;
      lines[i] = lines[i].replace(
        TASK_RE,
        (_m, a, c, b) => a + (c === " " ? "x" : " ") + b,
      );
      apply(replaceBlock(body, block, lines.join("\n")), keep);
      return;
    }
  }, []);

  // 外からの頼みを受けて編集を始める。どの単位で開くかは選択された位置から
  // 決める（表ならセル、箇条書きなら項目、それ以外はブロック全体）。
  // mermaid は生ソースを編集させない（図が壊れる）。
  // 描き終わる前に処理する。ここで待つと、頼みを受けた描画とエディタが乗る
  // 描画が別のフレームになり、押してから入力できるまでに 1 拍おく。
  useLayoutEffect(() => {
    // 別のファイルへの頼みは捨てる。ファイルを切り替えるとこの入れ物ごと
    // 作り直されるので、切り替え前の頼みがそのまま届く。
    if (!editRequest || editRequest.path !== contentKey) return;
    const block = blocks[editRequest.blockIndex];
    if (!block || isMermaidBlock(block.src)) return;
    setEditing(null);
    setEditingCell(null);
    setEditingItem(null);

    // 表のセル。目印は描画側が持っているソースオフセットなので、行と列は
    // そこから数え直せる。画面に出ている文字の位置から数えると、表では
    // 区切りがソースにしか無いぶんだけずれる。
    if (editRequest.cellStart !== undefined) {
      const unit = cellFromStart(block.src, editRequest.cellStart);
      if (unit) {
        setEditingCell({
          blockIndex: block.index,
          cellStart: editRequest.cellStart,
          lineIndex: unit.lineIndex,
          colIndex: unit.colIndex,
          value: cellValueAt(block.src, unit.lineIndex, unit.colIndex),
        });
        return;
      }
    }

    // 箇条書きの項目。マーカーが読めない行（継続行）はブロック全体に落ちる。
    if (editRequest.itemAnchor !== undefined) {
      const range = itemTextRange(block.src, editRequest.itemAnchor);
      if (range) {
        setEditingItem({
          blockIndex: block.index,
          anchor: editRequest.itemAnchor,
          start: range.start,
          end: range.end,
          value: block.src.slice(range.start, range.end),
        });
        return;
      }
    }

    setEditing({ index: block.index, x: null, y: null });
    // nonce だけを見る。同じ場所を続けて頼んでも開き直せる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest?.nonce]);

  // ブロックごと削除する。消す前の本文を渡して、取り消せるようにする。
  const remove = useCallback(
    (index: number) => {
      setEditing(null);
      const block = blocks[index];
      if (!block) return;
      const previous = body;
      apply(cutBlock(body, block), (i) => (i > index ? i - 1 : i));
      onDeleted?.(previous, "ブロックを削除しました");
    },
    [blocks, body, apply, onDeleted],
  );

  // 選択したところを消す。画面に出ている文字からソースの位置を出すので、
  // 消せない形（表のセルをまたぐ選択など）もある。そのときは知らせで返す。
  useLayoutEffect(() => {
    if (!deleteRequest || deleteRequest.path !== contentKey) return;
    const { blocks, body, apply } = latest.current;
    const block = blocks[deleteRequest.blockIndex];
    if (!block) return;
    const cut = cutSelection(body, block, deleteRequest);
    if (!cut) {
      onDeleted?.(
        null,
        isTableBlock(block.src)
          ? "表は 1 つのセルの中だけ消せます"
          : "選択したところは消せませんでした",
      );
      return;
    }
    setEditing(null);
    setEditingCell(null);
    setEditingItem(null);
    const index = block.index;
    apply(cut.body, cut.shift ? (i) => (i > index ? i - 1 : i) : keep);
    onDeleted?.(body, "選択したところを削除しました");
    // nonce だけを見る。同じ場所を続けて頼んでも効く。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteRequest?.nonce]);

  // つまみで動かす。to は「動かす前の並びで、どのブロックの前に置くか」。
  const move = useCallback(
    (from: number, to: number) => {
      setEditing(null);
      setPending(null);
      apply(moveBlock(body, blocks, from, to), (i) =>
        remapAfterMove(i, from, to),
      );
    },
    [blocks, body, apply],
  );

  const duplicate = useCallback(
    (index: number) => {
      const block = blocks[index];
      if (!block) return;
      apply(insertAfter(body, block, block.src), (i) =>
        i > index ? i + 1 : i,
      );
    },
    [blocks, body, apply],
  );

  // 表の並べ替え。書き換わるのはその表のブロック 1 つだけ。
  const isTable = useCallback(
    (index: number) => {
      const block = blocks[index];
      return !!block && isTableBlock(block.src);
    },
    [blocks],
  );

  // 表の操作。どれも書き換わるのはその表のブロック 1 つだけ。
  const editTable = useCallback(
    (index: number, change: (src: string) => string): string | null => {
      const block = blocks[index];
      if (!block) return null;
      const next = change(block.src);
      if (next === block.src) return null;
      apply(replaceBlock(body, block, next), keep);
      return next;
    },
    [blocks, body, apply],
  );

  // 足したばかりの行・列は中身が空で、選ぶ文字が無いので編集に入れない。
  // 位置から直に開く。
  const openCell = useCallback(
    (index: number, src: string, lineIndex: number, colIndex: number) => {
      const at = cellStartAt(src, lineIndex, colIndex);
      if (at === null) return;
      const unit = cellFromStart(src, at);
      if (!unit) return;
      setEditingCell({
        blockIndex: index,
        cellStart: at,
        lineIndex: unit.lineIndex,
        colIndex: unit.colIndex,
        value: "",
      });
    },
    [],
  );

  const moveTable = useCallback(
    (index: number, kind: Part, from: number, to: number) => {
      editTable(index, (src) =>
        kind === "row"
          ? moveTableRow(src, from, to)
          : moveTableColumn(src, from, to),
      );
    },
    [editTable],
  );

  const appendTable = useCallback(
    (index: number, kind: Part) => {
      const row = kind === "row";
      const next = editTable(index, row ? appendTableRow : appendTableColumn);
      if (!next) return;
      // 行は先頭の列、列は見出しから書き始められるようにする。
      const lines = next.split("\n");
      if (row) openCell(index, next, lines.length - 1, 0);
      else openCell(index, next, 0, cellsInRow(lines[0]) - 1);
    },
    [editTable, openCell],
  );

  const actOnTable = useCallback(
    (index: number, kind: Part, at: number, act: TableAct) => {
      const row = kind === "row";
      const next = editTable(index, (src) => {
        switch (act) {
          case "insertBefore":
            return row ? insertTableRow(src, at) : insertTableColumn(src, at);
          case "insertAfter":
            return row
              ? insertTableRow(src, at + 1)
              : insertTableColumn(src, at + 1);
          case "duplicate":
            return row
              ? duplicateTableRow(src, at)
              : duplicateTableColumn(src, at);
          case "clear":
            return row ? clearTableRow(src, at) : clearTableColumn(src, at);
          case "delete":
            return row ? deleteTableRow(src, at) : deleteTableColumn(src, at);
        }
      });
      // 差し込んだ直後は、そこへ書き始められるようにする。
      if (!next || (act !== "insertBefore" && act !== "insertAfter")) return;
      const to = act === "insertAfter" ? at + 1 : at;
      if (row) openCell(index, next, to, 0);
      else openCell(index, next, 0, to);
    },
    [editTable, openCell],
  );

  // ---- 箇条書きの項目 ----
  // Markdown ではリスト全体が 1 ブロックだが、掴む単位は項目に合わせる。
  const itemAt = useCallback(
    (index: number, offset: number) => {
      const block = blocks[index];
      if (!block) return null;
      const item = listItemAt(block.src, offset);
      return item ? { from: item.from, to: item.to } : null;
    },
    [blocks],
  );

  const moveItem = useCallback(
    (index: number, from: number, to: number) => {
      editTable(index, (src) => moveListItem(src, from, to));
    },
    [editTable],
  );

  const actOnItem = useCallback(
    (index: number, at: number, act: TableAct) => {
      if (act === "insertBefore" || act === "insertAfter") {
        const block = blocks[index];
        if (!block) return;
        const made = insertListItem(
          block.src,
          at,
          act === "insertBefore" ? "before" : "after",
        );
        if (!made) return;
        apply(replaceBlock(body, block, made.src), keep);
        // 空の項目は選ぶ文字が無い。位置から直に開く。
        const anchor = itemMarkerAt(made.src, made.line);
        const range = anchor === null ? null : itemTextRange(made.src, anchor);
        if (anchor !== null && range) {
          setEditingItem({
            blockIndex: index,
            anchor,
            start: range.start,
            end: range.end,
            value: "",
          });
        }
        return;
      }
      editTable(index, (src) =>
        act === "duplicate"
          ? duplicateListItem(src, at)
          : act === "clear"
            ? src
            : deleteListItem(src, at),
      );
    },
    [blocks, body, apply, editTable],
  );

  // コールアウトのアイコンを選び直す。開きタグの属性だけが変わる。
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

  // 差し込みは、確定した時に初めて本文へ書く。取り消せば何も残らない。
  const commitInsert = useCallback(
    (src: string) => {
      const at = pending;
      setPending(null);
      const block = at ? blocks[at.index] : null;
      if (!at || !block || src.trim() === "") return;
      const next =
        at.side === "after"
          ? insertAfter(body, block, src)
          : insertBefore(body, block, src);
      const border = at.side === "after" ? at.index : at.index - 1;
      apply(next, (i) => (i > border ? i + 1 : i));
    },
    [pending, blocks, body, apply],
  );

  // 内容ベースの安定 key。ブロックの追加/削除で index がずれても、内容が
  // 変わらないブロックは同じ key を保ち再マウントしない（削除時のちらつき防止）。
  const seen = new Map<string, number>();
  const keyOf = (src: string) => {
    const n = seen.get(src) ?? 0;
    seen.set(src, n + 1);
    return `${n}:${src}`;
  };

  // 差し込み用の空の編集欄。確定するまで本文には入らない。
  const inserting = pending && (
    <BlockSourceEditor
      key={`new:${pending.side}:${pending.index}`}
      src=""
      clickX={null}
      clickY={null}
      onCommit={commitInsert}
      onCancel={() => setPending(null)}
    />
  );

  const rows: ReactNode[] = [];
  for (const b of shown) {
    const key = keyOf(b.src);
    if (pending?.index === b.index && pending.side === "before") {
      rows.push(inserting);
    }
    rows.push(
      editing?.index === b.index ? (
        <BlockSourceEditor
          key={key}
          src={b.src}
          clickX={editing.x}
          clickY={editing.y}
          onCommit={(src) => commit(b.index, src)}
          onCancel={() => setEditing(null)}
          onDelete={() => remove(b.index)}
        />
      ) : (
        // display:contents で余白（prose の縦リズム）を崩さずに、
        // 選択やホバーの拾い先だけを作る
        <div
          key={key}
          className="mg-block"
          // 選択範囲からどのブロックかを辿るための目印。display:contents でも
          // 属性は残るので、キーボードでの選択でもブロックを特定できる。
          data-mg-block={b.index}
        >
          <Markdown
            body={b.src}
            editorial={editorial}
            onToggleTask={toggleTask}
            editCell={
              editingCell?.blockIndex === b.index
                ? {
                    cellStart: editingCell.cellStart,
                    value: editingCell.value,
                  }
                : undefined
            }
            onCellCommit={
              editingCell?.blockIndex === b.index ? commitCell : undefined
            }
            onCellCancel={
              editingCell?.blockIndex === b.index ? cancelCell : undefined
            }
            editItem={
              editingItem?.blockIndex === b.index
                ? { anchor: editingItem.anchor, value: editingItem.value }
                : undefined
            }
            onItemCommit={
              editingItem?.blockIndex === b.index ? commitItem : undefined
            }
            onItemCancel={
              editingItem?.blockIndex === b.index ? cancelItem : undefined
            }
          />
        </div>
      ),
    );
    if (pending?.index === b.index && pending.side === "after") {
      rows.push(inserting);
    }
  }

  return (
    <>
      {rows}
      <BlockGutter
        content={content ?? null}
        scroller={scroller ?? null}
        contentKey={contentKey ?? ""}
        isTable={isTable}
        onComment={(index) => onComment?.(index)}
        onTableMove={moveTable}
        onTableAct={actOnTable}
        onTableAppend={appendTable}
        onItemMove={moveItem}
        onItemAct={actOnItem}
        itemAt={itemAt}
        onEdit={(index) => {
          const block = blocks[index];
          // mermaid は生ソースを編集させない（図が壊れる）。
          if (!block || isMermaidBlock(block.src)) return;
          setPending(null);
          setEditing({ index, x: null, y: null });
        }}
        onMove={move}
        onInsert={(index, side) => {
          setEditing(null);
          setPending({ index, side });
        }}
        onDuplicate={duplicate}
        onDelete={remove}
      />
      <CalloutIcon
        content={content ?? null}
        contentKey={contentKey ?? ""}
        onPick={pickIcon}
      />
    </>
  );
}
