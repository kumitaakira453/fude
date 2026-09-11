import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { parseFrontmatter } from "../../lib/frontmatter";
import { contentCacheAtom } from "../../state/atoms";

// 指摘のファイルの本文。
//
// 控え（contentCacheAtom）に入るのはタブで開いたファイルだけで、指摘はどの
// ファイルにも付く。控えだけを見ると、一度も開いていないファイルの本文が
// いつまでも出てこないので、出す直前にここで読む。
//
// 読みに行ったパスは覚えておく。読めなかったファイルを描き直しのたびに
// 叩き直さないため。
export function useFileBody(rel: string | null): {
  body: string | null;
  // 前書きを含む生の字。指摘を付けたときの版として残すのはこちら。
  raw: string | undefined;
  reading: boolean;
} {
  const cache = useAtomValue(contentCacheAtom);
  const { reloadFile } = useWorkspace();
  const [reading, setReading] = useState(false);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (rel === null || cache.has(rel) || asked.current === rel) return;
    asked.current = rel;
    setReading(true);
    void reloadFile(rel).finally(() => setReading(false));
  }, [rel, cache, reloadFile]);

  const raw = rel === null ? undefined : cache.get(rel);
  return {
    body: raw === undefined ? null : parseFrontmatter(raw).body,
    raw,
    reading,
  };
}
