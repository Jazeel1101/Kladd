import { Button } from "@ui-sdk/react/button";
import { Textarea } from "@ui-sdk/react/textarea";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { ArrowUpIcon, CodeIcon, ImageIcon, MicIcon, SparklesIcon } from "./icons";
import { parseMarkdown, type Block, type Inline } from "./markdown";

/**
 * One message in the logging overlay's chat (GLOSSARY: "melding"), in Markdown. A `summary` is the
 * assistant's summary of the session (GLOSSARY: Summary), shown in a card.
 */
export interface ChatMessage {
  readonly from: "assistant" | "summary" | "student";
  readonly text: string;
}

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
            className="overflow-x-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] leading-relaxed"
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

const Markdown = ({ text, className }: { readonly text: string; readonly className?: string }) => (
  <div className={cn("flex flex-col gap-2 leading-relaxed", className)}>
    <Blocks blocks={parseMarkdown(text)} />
  </div>
);

/** The log assistant's face: its sparkles on a blue disc. */
const Avatar = () => (
  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-sky-400 to-indigo-500 text-white shadow-[0_2px_8px_rgb(59_130_246/0.35)]">
    <SparklesIcon size={14} />
  </span>
);

const Message = ({ message }: { readonly message: ChatMessage }) => {
  if (message.from === "student") {
    return (
      <li className="ml-10 self-end rounded-2xl rounded-br-md bg-zinc-800 px-3.5 py-2">
        <Markdown text={message.text} />
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2.5">
        <Avatar />
        {message.from === "assistant" ? (
          <Markdown text={message.text} className="pt-0.5" />
        ) : (
          <p className="pt-1">Her er en oppsummering av økta di.</p>
        )}
      </div>
      {message.from === "summary" && (
        <div className="ml-9.5 rounded-xl bg-zinc-800/80 py-3 pr-3.5 pl-3">
          <div className="border-l-[3px] border-blue-500 pl-3">
            <Markdown text={message.text} className="text-[12.5px]" />
          </div>
        </div>
      )}
    </li>
  );
};

/** The messages, newest at the bottom; they scroll inside the overlay, which never grows. */
export const Messages = ({ messages }: { readonly messages: ReadonlyArray<ChatMessage> }) => (
  <ol className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-1 pb-4 [scrollbar-width:thin]">
    {messages.map((message, i) => (
      <Message key={i} message={message} />
    ))}
  </ol>
);

const soon = "Kommer snart";

const ComposerButton = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => (
  <Button
    type="button"
    aria-label={label}
    title={`${label} – ${soon.toLowerCase()}`}
    disabled
    focusableWhenDisabled
    className="grid size-8 place-items-center rounded-lg border-0 bg-transparent p-0 text-zinc-400 aria-disabled:opacity-60"
  >
    {children}
  </Button>
);

/**
 * The chat composer (GLOSSARY: Composer). The overlay takes keyboard focus only when the student
 * clicks into it (LoggingOverlay gives it back on Esc). Sending, attaching a screenshot, code and
 * dictation wait for the log assistant.
 */
export const Composer = () => (
  <form
    className="mx-4 mb-4 flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.035] px-3 pt-2.5 pb-2 transition-colors focus-within:border-white/20"
    onSubmit={(event) => event.preventDefault()}
  >
    <Textarea
      aria-label="Melding til loggassistenten"
      placeholder="Hva lurer du på?"
      autoResize
      rows={1}
      className="max-h-28 min-h-6 resize-none border-0 bg-transparent p-0 text-[13px] leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
    />
    <div className="flex items-center gap-0.5">
      <ComposerButton label="Legg ved skjermbilde">
        <ImageIcon />
      </ComposerButton>
      <ComposerButton label="Sett inn kodebit">
        <CodeIcon />
      </ComposerButton>
      <ComposerButton label="Snakk inn meldingen">
        <MicIcon />
      </ComposerButton>
      <Button
        type="submit"
        aria-label="Send"
        title={`Send – ${soon.toLowerCase()}`}
        disabled
        focusableWhenDisabled
        className="ml-auto grid size-8 place-items-center rounded-full border-0 bg-zinc-700 p-0 text-zinc-300 aria-disabled:opacity-70"
      >
        <ArrowUpIcon />
      </Button>
    </div>
  </form>
);
