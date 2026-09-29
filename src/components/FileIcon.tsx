import { useAtomValue } from "jotai";
import { dirFace, fileFace, glyphOf } from "../lib/fileIcons";
import { folderIconsAtom } from "../state/atoms";
import { Icon } from "./Icon";

// ファイルとフォルダの顔。線画の字形に、種類ごとの色（index.css の
// .mg-ficon[data-tone]）を当てる。
//
// フォルダにアイコンを付けていれば（abs で引く）、その Material Symbols を
// アクセント色で描く。線の細さは線画の顔に揃え、塗りつぶさない。
const SYMBOL_SCALE = 1.15;

export function FileIcon({
  name,
  abs,
  dir = false,
  open = false,
  size = 16,
  className = "",
}: {
  name: string;
  abs?: string;
  dir?: boolean;
  open?: boolean;
  size?: number;
  className?: string;
}) {
  const custom = useAtomValue(folderIconsAtom);
  const symbol = dir && abs ? custom[abs] : undefined;
  if (symbol) {
    // Material Symbols の字形は枠の内側に余白を持ち、同じ大きさでは線画の顔より
    // 一回り小さく見える。字形だけを大きく描き、はみ出す分は負の余白で打ち消して
    // 行の幅と高さは線画の顔と揃える。
    const big = Math.round(size * SYMBOL_SCALE);
    const pull = (size - big) / 2;
    return (
      <Icon
        name={symbol}
        size={big}
        weight={300}
        className={`mg-ficon mg-ficon-sym shrink-0 ${className}`}
        style={{ margin: pull }}
      />
    );
  }
  const face = dir ? dirFace(name, open) : fileFace(name);
  const inner = glyphOf(face.glyph) ?? glyphOf("file") ?? "";
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`mg-ficon shrink-0 ${className}`}
      data-tone={face.tone}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
