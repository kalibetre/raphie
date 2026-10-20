import { ArrowLeft } from "lucide-react";

import { type Section, sections } from "./settings";

export function SettingsNav({
  section,
  open,
  onSelect,
  onBack,
}: {
  section: Section;
  open: boolean;
  onSelect: (section: Section) => void;
  onBack: () => void;
}) {
  return (
    <aside
      className={`sidebar ${open ? "sidebar-open" : ""}`}
      aria-label="Settings navigation"
    >
      <div className="sidebar-top">
        <div className="brand">Settings</div>
      </div>
      <nav className="settings-nav">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={section === id ? "selected" : ""}
            aria-current={section === id ? "page" : undefined}
            onClick={() => onSelect(id)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="settings-back" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
      </div>
    </aside>
  );
}
