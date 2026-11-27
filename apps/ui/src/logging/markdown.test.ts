import { assert, describe, it } from "@effect/vitest";
import { parseInline, parseMarkdown } from "./markdown";

const text = (value: string) => ({ type: "text", text: value }) as const;

describe("parseInline", () => {
  it("reads bold, italics and inline code, and nests them", () => {
    assert.deepStrictEqual(parseInline("**Mål:** sjekk `auth.js` *nå*"), [
      { type: "strong", children: [text("Mål:")] },
      text(" sjekk "),
      { type: "code", text: "auth.js" },
      text(" "),
      { type: "em", children: [text("nå")] },
    ]);
    assert.deepStrictEqual(parseInline("**fikset *CORS* i dag**"), [
      {
        type: "strong",
        children: [text("fikset "), { type: "em", children: [text("CORS")] }, text(" i dag")],
      },
    ]);
  });

  it("leaves snake_case names, lone stars and code contents alone", () => {
    assert.deepStrictEqual(parseInline("kall user_login_check"), [text("kall user_login_check")]);
    assert.deepStrictEqual(parseInline("2 * 3 * 4"), [text("2 * 3 * 4")]);
    assert.deepStrictEqual(parseInline("`a *b* c`"), [{ type: "code", text: "a *b* c" }]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs and fenced code", () => {
    const blocks = parseMarkdown("## Økt\nFørste linje\nandre linje\n\n```\nnpm i cors\n```");
    assert.deepStrictEqual(blocks, [
      { type: "heading", level: 2, inline: [text("Økt")] },
      { type: "paragraph", inline: [text("Første linje andre linje")] },
      { type: "code", text: "npm i cors" },
    ]);
  });

  it("nests lists by indentation, and joins wrapped lines to their item", () => {
    const blocks = parseMarkdown(
      [
        "- **Fremgang:**",
        "  - Validering av e-post",
        "    og passord",
        "  - Koblet skjemaet",
        "",
        "- Neste gang",
        "1. ordnet",
      ].join("\n"),
    );
    assert.deepStrictEqual(blocks, [
      {
        type: "list",
        ordered: false,
        items: [
          {
            inline: [{ type: "strong", children: [text("Fremgang:")] }],
            children: [
              {
                type: "list",
                ordered: false,
                items: [
                  { inline: [text("Validering av e-post og passord")], children: [] },
                  { inline: [text("Koblet skjemaet")], children: [] },
                ],
              },
            ],
          },
          { inline: [text("Neste gang")], children: [] },
          { inline: [text("ordnet")], children: [] },
        ],
      },
    ]);
  });

  it("ends a paragraph at a list", () => {
    const blocks = parseMarkdown("Her er økta:\n- én ting");
    assert.deepStrictEqual(
      blocks.map((block) => block.type),
      ["paragraph", "list"],
    );
  });
});
