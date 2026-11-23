import { Textarea } from "../../../shared/ui/textarea";
import { MAX_RULES, rulesOf, rulesProblem } from "../application/rules";

/**
 * Standing rules, one a line: what the owner wants done every time. A bot
 * reads them in every conversation, so they are kept few and short.
 */
export function RulesField({
  id,
  title,
  note,
  placeholder,
  value,
  pending,
  onChange,
}: {
  id: string;
  title: string;
  note: string;
  placeholder: string;
  /** The text being edited, one rule a line. */
  value: string;
  pending: boolean;
  onChange: (value: string) => void;
}) {
  const rules = rulesOf(value);
  const problem = rulesProblem(rules);
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
          className="rules-field min-h-32 text-sm leading-relaxed"
          placeholder={placeholder}
          value={value}
          disabled={pending}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${id}-count`}
          onChange={(event) => onChange(event.target.value)}
        />
        <p id={`${id}-count`} role={problem ? "alert" : undefined}>
          {problem ||
            `One rule a line · ${rules.length} of ${MAX_RULES} · Rules say how to work and grant nothing.`}
        </p>
      </div>
    </section>
  );
}
