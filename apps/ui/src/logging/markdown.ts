/**
 * The Markdown of `summary.md`, parsed into blocks for the overlay to render as React
 * elements, never as HTML: paragraphs, headings, nested lists, fenced code, and bold, italics and
 * inline code inside them. Anything else stays plain text.
 */

export type Inline =
  | { readonly type: "text" | "code"; readonly text: string }
  | { readonly type: "strong" | "em"; readonly children: ReadonlyArray<Inline> };

interface ListItem {
  readonly inline: ReadonlyArray<Inline>;
  /** Lists nested under the item. */
  readonly children: ReadonlyArray<Block>;
}

export type Block =
  | { readonly type: "paragraph"; readonly inline: ReadonlyArray<Inline> }
  | { readonly type: "heading"; readonly level: number; readonly inline: ReadonlyArray<Inline> }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: ReadonlyArray<ListItem> }
  | { readonly type: "code"; readonly text: string };

// Underscores mark italics only outside words, so snake_case names stay as they are.
const inlinePattern =
  /`([^`]+)`|\*\*(.+?)\*\*|\*([^*\s](?:[^*]*?[^*\s])?)\*|(?<!\w)_([^_\s](?:[^_]*?[^_\s])?)_(?!\w)/g;

export const parseInline = (text: string): ReadonlyArray<Inline> => {
  const parts: Array<Inline> = [];
  let last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > last) parts.push({ type: "text", text: text.slice(last, match.index) });
    const [, code, strong, star, underscore] = match;
    if (code !== undefined) parts.push({ type: "code", text: code });
    else if (strong !== undefined) parts.push({ type: "strong", children: parseInline(strong) });
    else parts.push({ type: "em", children: parseInline(star ?? underscore ?? "") });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
};

const listItemPattern = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const headingPattern = /^(#{1,6})\s+(.*)$/;
const fencePattern = /^\s*```/;

const indentOf = (line: string): number => {
  const leading = /^\s*/.exec(line)?.[0] ?? "";
  return leading.replaceAll("\t", "    ").length;
};

const listItem = (line: string) => {
  const match = listItemPattern.exec(line);
  if (match === null) return null;
  const [, , marker = "", text = ""] = match;
  return { indent: indentOf(line), ordered: /\d/.test(marker), text };
};

const isBlank = (line: string) => line.trim() === "";

/** The list whose items are indented `indent`, from line `start`; and the line after it. */
const parseList = (
  lines: ReadonlyArray<string>,
  start: number,
  indent: number,
): { readonly list: Block; readonly next: number } => {
  const items: Array<{ text: string; children: Array<Block> }> = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (isBlank(line)) {
      // A blank line ends the list unless an item at its depth or deeper follows.
      let ahead = i + 1;
      while (ahead < lines.length && isBlank(lines[ahead] ?? "")) ahead++;
      const following = listItem(lines[ahead] ?? "");
      if (following === null || following.indent < indent) break;
      i = ahead;
      continue;
    }
    const item = listItem(line);
    const current = items.at(-1);
    if (item !== null && item.indent === indent) {
      items.push({ text: item.text, children: [] });
      i++;
    } else if (item !== null && item.indent > indent) {
      const nested = parseList(lines, i, item.indent);
      if (current === undefined) items.push({ text: "", children: [nested.list] });
      else current.children.push(nested.list);
      i = nested.next;
    } else if (item === null && current !== undefined && indentOf(line) > indent) {
      // A wrapped line of the item above.
      current.text += ` ${line.trim()}`;
      i++;
    } else {
      break;
    }
  }
  const ordered = listItem(lines[start] ?? "")?.ordered ?? false;
  return {
    list: {
      type: "list",
      ordered,
      items: items.map(({ text, children }) => ({ inline: parseInline(text), children })),
    },
    next: i,
  };
};

export const parseMarkdown = (source: string): ReadonlyArray<Block> => {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: Array<Block> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (isBlank(line)) {
      i++;
      continue;
    }
    if (fencePattern.test(line)) {
      const code: Array<string> = [];
      i++;
      while (i < lines.length && !fencePattern.test(lines[i] ?? "")) code.push(lines[i++] ?? "");
      blocks.push({ type: "code", text: code.join("\n") });
      i++;
      continue;
    }
    const heading = headingPattern.exec(line);
    if (heading !== null) {
      const [, hashes = "", text = ""] = heading;
      blocks.push({ type: "heading", level: hashes.length, inline: parseInline(text) });
      i++;
      continue;
    }
    const item = listItem(line);
    if (item !== null) {
      const { list, next } = parseList(lines, i, item.indent);
      blocks.push(list);
      i = next;
      continue;
    }
    const paragraph: Array<string> = [];
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (isBlank(next) || fencePattern.test(next) || headingPattern.test(next)) break;
      if (listItem(next) !== null) break;
      paragraph.push(next.trim());
      i++;
    }
    blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
  }
  return blocks;
};
