import { atom } from "jotai";
import { DRAFT, inDrafts } from "../lib/drafts";
import { draftsDirAtom, soleAtom } from "./atoms";

// 下書きの見せ方を、画面のあちこちから同じ値で引くための導出。
//
// 名前は中身に同期させない。打つたびにタブや木の見出しが動くと落ち着かないし、
// 本文の控えを購読することになって打鍵の経路に描き直しが乗る。中身から採った
// 名前を使うのは、保存先を決めるときの既定のファイル名だけ。

// 下書きとして開いているファイルの、根からの相対パス。下書きでなければ null。
export const draftRelAtom = atom<string | null>((get) => {
  const sole = get(soleAtom);
  if (!inDrafts(sole, get(draftsDirAtom))) return null;
  return sole?.split("/").pop() ?? null;
});

// 下書きに出す名前。下書きでなければ空。
export const draftNameAtom = atom<string>((get) => (get(draftRelAtom) ? DRAFT : ""));
