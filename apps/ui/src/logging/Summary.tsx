import type { SummaryStatus } from "@kladd/domain";
import { cn } from "../lib/cn";
import { parseMarkdown, type Block, type Inline } from "./markdown";

const InlineText = ({ parts }: { readonly parts: ReadonlyArray<Inline> }) =>
  parts.map((part, i) => {
    switch (part.type) {
      case "text":
        return part.text;
      case "code":
        return (
          <code key={i} className="font-mono text-[0.92em] text-zinc-200">
            {part.text}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-semibold text-zinc-50">
            <InlineText parts={part.children} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <InlineText parts={part.children} />
          </em>
        );
    }
  });

const Blocks = ({ blocks }: { readonly blocks: ReadonlyArray<Block> }) =>
  blocks.map((block, i) => {
    switch (block.type) {
      case "paragraph":
        return (
          <p key={i}>
            <InlineText parts={block.inline} />
          </p>
        );
      case "heading":
        return (
          <p key={i} className="font-semibold text-zinc-50">
            <InlineText parts={block.inline} />
          </p>
        );
      case "code":
        return (
          <pre
            key={i}
            className="shrink-0 overflow-x-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] leading-relaxed"
          >
            {block.text}
          </pre>
        );
      case "list": {
        const List = block.ordered ? "ol" : "ul";
        return (
          <List
            key={i}
            className={cn(
              "flex flex-col gap-1 pl-4.5",
              block.ordered ? "list-decimal" : "list-disc",
            )}
          >
            {block.items.map((item, j) => (
              <li key={j} className="pl-0.5 marker:text-zinc-400">
                <InlineText parts={item.inline} />
                {item.children.length > 0 && (
                  <div className="mt-1 flex flex-col gap-1">
                    <Blocks blocks={item.children} />
                  </div>
                )}
              </li>
            ))}
          </List>
        );
      }
    }
  });

/** What the panel says while there is no summary to show. */
const notWritten = {
  Writing: "Skriver oppsummeringen av økta …",
  Failed: "Fikk ikke skrevet en oppsummering av økta. Du kan skrive loggen uten den.",
} as const;

/**
 * The ended session's `summary.md` (GLOSSARY: "oppsummering"), rendered from its Markdown, or how
 * far the summary agent has come. It scrolls inside the overlay, which never grows.
 */
export const Summary = ({ summary }: { readonly summary: SummaryStatus | null }) => (
  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 pb-5 leading-relaxed [scrollbar-width:thin]">
    {summary?._tag === "Written" ? (
      <Blocks blocks={parseMarkdown(summary.text)} />
    ) : (
      summary !== null && <p className="text-zinc-400">{notWritten[summary._tag]}</p>
    )}
  </div>
);
