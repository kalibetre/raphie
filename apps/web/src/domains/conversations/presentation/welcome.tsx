import {
  Activity as ActivityIcon,
  ArrowUpRight,
  CircleHelp,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";

export function Welcome({
  disabled,
  onSuggest,
}: {
  disabled: boolean;
  onSuggest: (text: string) => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-mark">
        r<span />
      </div>
      <span className="eyebrow">A LITTLE CLARITY FOR YOUR DAY</span>
      <h2>What’s on your mind?</h2>
      <p>
        A place to think things through, get things done,
        <br />
        and keep the details in view.
      </p>
      <div className="suggestions">
        {[
          "Help me plan my day",
          "Think through an idea",
          "What can you help me with?",
        ].map((text, index) => (
          <button
            key={text}
            disabled={disabled}
            onClick={() => onSuggest(text)}
          >
            <span>
              {index === 0 ? (
                <ActivityIcon size={17} />
              ) : index === 1 ? (
                <MessageSquare size={17} />
              ) : (
                <CircleHelp size={17} />
              )}
              {text}
            </span>
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
      <div className="welcome-note">
        <ShieldCheck size={14} /> You’re in control. Review connected actions
        before they run.
      </div>
    </div>
  );
}
