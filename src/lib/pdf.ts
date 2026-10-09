import type { PDFDocumentProxy } from "pdfjs-dist";

// PDF を読む道具（pdf.js）。大きいので、PDF を開いたときに初めて読む。
//
// 文字の対応表・標準の書体・画像の復号器は、ビルドで pdfjs/ の下に置く
// （vite.config.ts の pdfjsAssets）。日本語の PDF は書体を埋め込まずに
// 対応表を引くものが多く、無いと字が出ない。

// PDF の 1pt を画面の CSS px に直す比。倍率 1 が実寸になる。
export const PDF_TO_CSS = 96 / 72;

type Pdfjs = typeof import("pdfjs-dist");

let loading: Promise<Pdfjs> | null = null;

export function pdfjs(): Promise<Pdfjs> {
  loading ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return loading;
}

const shipped = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;

// バイト列から開く。閉じるときは返した destroy を呼ぶ。
export async function openPdf(
  data: ArrayBuffer,
): Promise<{ doc: Promise<PDFDocumentProxy>; destroy: () => void }> {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data,
    cMapUrl: shipped("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: shipped("standard_fonts"),
    wasmUrl: shipped("wasm"),
    iccUrl: shipped("iccs"),
  });
  return { doc: task.promise, destroy: () => void task.destroy() };
}
