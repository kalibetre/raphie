import type { ReactNode } from "react";

import { Textarea } from "../../../shared/ui/textarea";

/** The same bound the runtime keeps. */
export const MAX_INSTRUCTIONS = 16_000;

/**
 * Instructions a bot reads in every conversation on working with its
 * tools: kept by the owner here and by the bot when asked to note something.
 */
export function InstructionsField({
  id,
  title,
  note,
  placeholder,
  value,
  pending,
  status,
  action,
  onChange,
}: {
  id: string;
  title: string;
  note: string;
  placeholder: string;
  value: string;
  pending: boolean;
  /** Said in the editor's heading, as a personality says its revision. */
  status: string;
  /** A control beside the count, such as a reset. */
  action?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <section className="bot-editor-section" aria-label={title}>
      <h2>{title}</h2>
      <p>{note}</p>
      <div className="bot-form settings-form">
        <label htmlFor={id} className="sr-only">
          {title}
        </label>
        {/* The personality's editor, so the two read as one kind of text. */}
        <div className="personality-editor">
          <div className="personality-editor-heading">
            <strong>In your words</strong>
            <span>{status}</span>
          </div>
          <Textarea
            id={id}
            className="bot-personality min-h-64 resize-y rounded-none border-0 p-4 text-sm leading-relaxed shadow-none md:min-h-72"
            maxLength={MAX_INSTRUCTIONS}
            placeholder={placeholder}
            value={value}
            disabled={pending}
            aria-describedby={`${id}-count`}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        <div className="instructions-foot">
          <p id={`${id}-count`}>
            {value.length.toLocaleString()} /{" "}
            {MAX_INSTRUCTIONS.toLocaleString()} · They say how to work and grant
            nothing.
          </p>
          {action}
        </div>
      </div>
    </section>
  );
}
