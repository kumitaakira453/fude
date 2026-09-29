import { useAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVisibleRows } from "../hooks/useVisibleRows";
import { searchSymbols } from "../lib/folderIcons";
import { folderIconsAtom } from "../state/atoms";
import { Icon } from "./Icon";

// フォルダのアイコンを選ぶ盤。Material Symbols から 1 つ選ぶと、そのフォルダに
// 付けて閉じる。色は選ばせず、テーマのアクセント色で描く。
//
// 名前は英語だけ（Material Symbols に日本語の名前は無い）。一覧は約 3,900 個
// あるので、見えている段だけを組む。

const COLS = 10;
// 1 段の高さ（px）。index.css の .mg-ficon-pick-cell と対にする。
const ROW = 36;
const WIDTH = 392;
const HEIGHT = 420;

// 盤を出す位置。x はメニューの右隣、left はメニューの左端（右にはみ出すときは
// メニューの左に出す）、y は押した項目の上端。
export interface IconPickerState {
  x: number;
  y: number;
  left: number;
  abs: string;
  name: string;
}

// 盤の左上。メニューの右隣に入らなければ左に、下に入らなければ上へずらす。
export function pickerPlace(
  at: Pick<IconPickerState, "x" | "y" | "left">,
  view: { width: number; height: number },
): { left: number; top: number } {
  const fitsRight = at.x + WIDTH <= view.width - 8;
  const left = fitsRight ? at.x : Math.max(8, at.left - WIDTH);
  const top = Math.max(8, Math.min(at.y, view.height - HEIGHT - 8));
  return { left, top };
}

export function FolderIconPicker({
  at,
  onClose,
}: {
  at: IconPickerState;
  onClose: () => void;
}) {
  const [icons, setIcons] = useAtom(folderIconsAtom);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const current = icons[at.abs];
  const found = useMemo(() => searchSymbols(query), [query]);
  const rows = Math.ceil(found.length / COLS);
  const [start, end] = useVisibleRows(grid, rows, ROW);

  // 絞り込みを変えたら、一覧の頭へ戻す。
  useEffect(() => {
    if (grid.current?.parentElement) grid.current.parentElement.scrollTop = 0;
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // 外を押したら閉じる。メニューの中は外に数えない（メニューの項目は
    // メニューの側で処理し、盤もそこで閉じる）。
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (box.current?.contains(t) || t.closest("[data-entry-menu]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  const pick = (symbol: string) => {
    setIcons((was) => ({ ...was, [at.abs]: symbol }));
    onClose();
  };
  const reset = () => {
    setIcons((was) => {
      const { [at.abs]: _, ...rest } = was;
      return rest;
    });
    onClose();
  };

  const style: React.CSSProperties = {
    ...pickerPlace(at, { width: window.innerWidth, height: window.innerHeight }),
    width: WIDTH,
    height: HEIGHT,
  };

  // ぼかしを掛けた枠の中に置くと fixed の基準がそこになる。body へ出して逃がす。
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="アイコンを変更"
      className="mg-ficon-pick"
      style={style}
      // メニューは窓の click で閉じる。盤の中の click は上へ伝えない。
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mg-ficon-pick-head">
        <span className="mg-ficon-pick-title">{at.name} のアイコン</span>
        {current && (
          <button type="button" className="mg-small" onClick={reset}>
            元に戻す
          </button>
        )}
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && found[0]) pick(found[0]);
        }}
        placeholder="英語の名前で検索（folder, book, star…）"
        className="mg-ficon-pick-search"
      />
      <div className="mg-ficon-pick-list">
        {found.length === 0 ? (
          <div className="mg-ficon-pick-none">一致するアイコンがありません</div>
        ) : (
          <div ref={grid} style={{ height: rows * ROW, position: "relative" }}>
            {found.slice(start * COLS, end * COLS).map((symbol, i) => {
              const n = start * COLS + i;
              return (
                <button
                  key={symbol}
                  type="button"
                  aria-label={symbol}
                  className={`mg-ficon-pick-cell${symbol === current ? " is-on" : ""}`}
                  style={{ top: Math.floor(n / COLS) * ROW, left: `${(n % COLS) * (100 / COLS)}%` }}
                  onMouseEnter={() => setHover(symbol)}
                  onMouseLeave={() => setHover((h) => (h === symbol ? null : h))}
                  onClick={() => pick(symbol)}
                >
                  <Icon name={symbol} size={22} weight={300} />
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* WKWebView は title の吹き出しを出さないので、指している名前は下に出す。 */}
      <div className="mg-ficon-pick-foot">
        {(hover ?? current ?? "").replace(/_/g, " ") ||
          `${found.length.toLocaleString()} 個`}
      </div>
    </div>,
    document.body,
  );
}
