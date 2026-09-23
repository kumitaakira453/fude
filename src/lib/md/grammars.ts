import { all } from "lowlight";
import { hcl } from "./hcl";

// 色を付けられる言語。読むとき（rehype-highlight）と書くとき（編集面の装飾）、
// 原文をそのまま見るときの 3 経路が、ここ 1 つを見る。
//
// highlight.js が持たないものだけを足す。
export const GRAMMARS = { ...all, hcl };
