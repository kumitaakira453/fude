import { convertFileSrc } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { assetVersionAtom } from "../state/atoms";

// PDF を 1 枚の書き物として開く。
//
// 描くのは WebView が内に持つビューア。頁送りも拡大もそちらが備えているので、
// こちらから重ねない（二重の拡大は手触りが合わなくなる）。

export function PdfDoc({ abs }: { abs: string }) {
  const version = useAtomValue(assetVersionAtom);
  // 版を付けて、外で書き換わったときに WebView の控えを跨がせる。
  const src = useMemo(() => `${convertFileSrc(abs)}?v=${version}`, [abs, version]);
  return (
    <iframe
      key={src}
      src={src}
      title={abs.split("/").pop() ?? ""}
      className="min-h-0 w-full flex-1 border-0"
    />
  );
}
