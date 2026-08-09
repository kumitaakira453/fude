import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { highlightAtom } from "../state/atoms";

// CSS Custom Highlight API で検索語を非破壊ハイライトし、先頭へスクロールする。
// DOM を書き換えないため、レイアウト崩れが起きない。
export function useSearchHighlight(
  container: HTMLElement | null,
  isActive: boolean,
) {
  const highlight = useAtomValue(highlightAtom);

  useEffect(() => {
    const cssHighlights = (
      CSS as unknown as { highlights?: Map<string, unknown> }
    ).highlights;
    const HighlightCtor = (
      window as unknown as { Highlight?: new (...r: Range[]) => unknown }
    ).Highlight;
    if (!cssHighlights || !HighlightCtor) return;

    cssHighlights.delete("mgsearch");
    if (!container || !isActive || !highlight || !highlight.term) return;

    let re: RegExp;
    try {
      const flags = highlight.caseSensitive ? "g" : "gi";
      const pat = highlight.useRegex
        ? highlight.term
        : highlight.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      re = new RegExp(pat, flags);
    } catch {
      return;
    }

    const ranges: Range[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let first: Range | null = null;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue ?? "";
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const len = m[0].length || 1;
        const range = new Range();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + len);
        ranges.push(range);
        if (!first) first = range;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }

    if (ranges.length) {
      cssHighlights.set("mgsearch", new HighlightCtor(...ranges));
      const target = first?.startContainer.parentElement;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return () => {
      cssHighlights.delete("mgsearch");
    };
  }, [container, isActive, highlight]);
}
