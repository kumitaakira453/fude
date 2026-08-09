import { useAtomValue } from "jotai";
import { memo, useContext, useEffect, useState } from "react";
import { assetVersionAtom } from "../state/atoms";
import { markdownContext } from "./MarkdownContext";

// 相対パス画像をローカル FS から解決して表示する。
// object URL はセッション内キャッシュから同期取得し、revoke しないため
// スクロールや再レンダーで消えたりちらついたりしない。
function MdImageInner({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const ctx = useContext(markdownContext);
  const isRemote = !!src && /^(https?:|data:|blob:)/.test(src);

  // 初期値をキャッシュから同期取得（再マウント時に一瞬消えるのを防ぐ）
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!src) return null;
    if (isRemote) return src;
    return ctx?.peekAsset(src) ?? null;
  });
  const [failed, setFailed] = useState(false);
  // 画像が変わると increment される。これを見て再取得する。
  const assetVersion = useAtomValue(assetVersionAtom);

  useEffect(() => {
    if (!src || isRemote || !ctx) return;
    let alive = true;
    ctx
      .resolveAsset(src)
      .then((r) => {
        if (!alive) return;
        if (r) {
          setResolved(r);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // assetVersion が変わったら（画像更新時）再解決する
  }, [src, isRemote, ctx, assetVersion]);

  if (failed || (!resolved && !isRemote)) {
    return (
      <span className="mg-img-missing inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--mg-border)] px-2 py-1 text-xs text-[var(--mg-muted)]">
        🖼 {alt || src || "画像"}
      </span>
    );
  }

  return (
    <img
      src={(isRemote ? src : resolved) ?? undefined}
      alt={alt}
      title={title}
      loading="lazy"
      onError={() => setFailed(true)}
      className="mx-auto my-4 max-w-full rounded-lg shadow-md"
    />
  );
}

export const MdImage = memo(MdImageInner);
