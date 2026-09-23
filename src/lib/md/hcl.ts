import type { HLJSApi, Language } from "highlight.js";

// HCL（Terraform の .tf / .tfvars）の読み取り。
//
// highlight.js は HCL を持たないので、拡張子でも囲みの言語名でも色が付かない。
// 書く側では日常的に開くものなので、要る分だけ自前で置く。
//
// 読むとき（rehype-highlight）と書くとき（編集面の装飾）の両方が同じものを
// 使う。片方だけに足すと、読むときは色が付かない言語が編集中だけ色付く。

export function hcl(hljs: HLJSApi): Language {
  const inside = {
    className: "subst",
    begin: /\$\{/,
    end: /\}/,
    keywords: { built_in: "var local module data each count path" },
  };

  return {
    name: "HCL",
    aliases: ["tf", "tfvars", "terraform"],
    keywords: {
      keyword:
        "resource provider variable output locals module data terraform " +
        "backend provisioner connection lifecycle dynamic for for_each in if else",
      built_in:
        "var local each count path self depends_on source type default " +
        "description sensitive validation",
      literal: "true false null",
    },
    contains: [
      hljs.COMMENT("#", "$"),
      hljs.COMMENT("//", "$"),
      hljs.COMMENT("/\\*", "\\*/"),
      // 塊の見出しに付く名前（resource "aws_s3_bucket" "置き場" {）。
      {
        className: "string",
        begin: /"/,
        end: /"/,
        illegal: /\n/,
        contains: [{ begin: /\\./ }, inside],
      },
      // 行内に書き下す長い字（<<EOT … EOT）。
      {
        className: "string",
        begin: /<<[-~]?([A-Z]+)/,
        end: /^\s*[A-Z]+\s*$/,
        contains: [inside],
      },
      hljs.NUMBER_MODE,
      // 鍵 = 値 の鍵。塊の中の並びが読み取れる。
      {
        className: "attr",
        begin: /[A-Za-z_][\w-]*(?=\s*=[^=])/,
      },
      {
        className: "operator",
        begin: /[=?:]|=>|&&|\|\||[<>!]=?/,
      },
    ],
  };
}
