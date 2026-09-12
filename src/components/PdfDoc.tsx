import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { assetSrc } from "../lib/asset";
import { assetVersionAtom } from "../state/atoms";

// PDF を 1 枚の書き物として開く。
//
// 描くのは WebView が内に持つビューア。頁送りも拡大もそちらが備えているので、
// こちらから重ねない（二重の拡大は手触りが合わなくなる）。

export function PdfDoc({ abs }: { abs: string }) {
  const version = useAtomValue(assetVersionAtom);
  const src = useMemo(() => assetSrc(abs, version), [abs, version]);
  return (
    <iframe
      key={src}
      src={src}
      title={abs.split("/").pop() ?? ""}
      className="min-h-0 w-full flex-1 border-0"
    />
  );
}
