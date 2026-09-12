import { atom } from "jotai";
import { draftLabel, inDrafts } from "../lib/drafts";
import { contentCacheAtom, draftsDirAtom, soleAtom } from "./atoms";

// 下書きの見せ方を、画面のあちこちから同じ値で引くための導出。
//
// 中身から名前を採るので本文の控えに依るが、返すのは字 1 つだけにしてある。
// 打つたびに木やタブを描き直さないため（変わるのは見出しを書き換えた瞬間だけ）。

// 下書きとして開いているファイルの、根からの相対パス。下書きでなければ null。
export const draftRelAtom = atom<string | null>((get) => {
  const sole = get(soleAtom);
  if (!inDrafts(sole, get(draftsDirAtom))) return null;
  return sole?.split("/").pop() ?? null;
});

// 下書きに出す名前。下書きでなければ空。
export const draftNameAtom = atom<string>((get) => {
  const rel = get(draftRelAtom);
  if (!rel) return "";
  return draftLabel(get(contentCacheAtom).get(rel) ?? "");
});
