import { dirFace, fileFace, glyphOf } from "../lib/fileIcons";

// ファイルとフォルダの顔。線画の字形に、種類ごとの色（index.css の
// .mg-ficon[data-tone]）を当てる。
export function FileIcon({
  name,
  dir = false,
  open = false,
  size = 16,
  className = "",
}: {
  name: string;
  dir?: boolean;
  open?: boolean;
  size?: number;
  className?: string;
}) {
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
