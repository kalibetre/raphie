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
  /** Said under the field before the count, such as whose text it is. */
  status?: string;
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
        <Textarea
          id={id}
          className="instructions-field min-h-48 text-sm leading-relaxed"
          maxLength={MAX_INSTRUCTIONS}
          placeholder={placeholder}
          value={value}
          disabled={pending}
          aria-describedby={`${id}-count`}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="instructions-foot">
          <p id={`${id}-count`}>
            {status ? `${status} · ` : ""}
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
