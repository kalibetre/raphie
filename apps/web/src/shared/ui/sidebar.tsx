import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { Dialog } from "@base-ui/react/dialog";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { ChevronRight, X } from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";

import { cn } from "./utils";

// Shadcn's header/content/footer and menu composition, adapted to our
// resizable workspace. Base UI Dialog provides the mobile sheet behavior.
export function Sidebar({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (!mobile)
    return (
      <aside data-slot="sidebar" className="sidebar" aria-label={label}>
        {children}
      </aside>
    );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="sidebar-backdrop" />
        <Dialog.Popup
          data-slot="sidebar"
          className="sidebar sidebar-open"
          aria-describedby={undefined}
          finalFocus={() =>
            document.querySelector<HTMLButtonElement>(
              '[aria-label="Open navigation"]',
            )
          }
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <Dialog.Close className="sidebar-close" aria-label="Close navigation">
            <X size={16} />
          </Dialog.Close>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SidebarHeader(props: ComponentProps<"div">) {
  return <div data-slot="sidebar-header" className="sidebar-top" {...props} />;
}

export function SidebarContent({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <ScrollArea.Root data-slot="sidebar-content" className="sidebar-content">
      <ScrollArea.Viewport
        className="sidebar-viewport"
        role="group"
        aria-label={label}
      >
        {children}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="sidebar-scrollbar">
        <ScrollArea.Thumb className="sidebar-thumb" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

export function SidebarFooter(props: ComponentProps<"div">) {
  return (
    <div data-slot="sidebar-footer" className="sidebar-bottom" {...props} />
  );
}

export function SidebarGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div data-slot="sidebar-group" className="sidebar-group">
      <div data-slot="sidebar-group-label" className="sidebar-group-label">
        {label}
      </div>
      {children}
    </div>
  );
}

export function SidebarMenuButton({
  active = false,
  className,
  ...props
}: Omit<ComponentProps<typeof ButtonPrimitive>, "className"> & {
  active?: boolean;
  className?: string;
}) {
  return (
    <ButtonPrimitive
      type="button"
      data-slot="sidebar-menu-button"
      data-active={active}
      aria-current={active ? "page" : undefined}
      className={cn("sidebar-menu-button", className)}
      {...props}
    />
  );
}

/**
 * A menu item that expands to show sub-items, like shadcn's collapsible nav.
 * It opens whenever one of its items becomes active (including via browser
 * history), so the current page is never hidden in a collapsed group.
 */
export function SidebarMenuCollapsible({
  label,
  icon,
  active = false,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  /** One of the sub-items is the current page. */
  active?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger
        data-slot="sidebar-menu-button"
        // Collapsed over the current page: highlight the group instead.
        data-active={active && !open}
        className="sidebar-menu-button sidebar-menu-collapsible"
      >
        {icon} {label}
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="sidebar-menu-chevron"
        />
      </Collapsible.Trigger>
      <Collapsible.Panel>
        <div data-slot="sidebar-menu-sub" className="sidebar-menu-sub">
          {children}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function SidebarMenuSubButton({
  className,
  ...props
}: ComponentProps<typeof SidebarMenuButton>) {
  return (
    <SidebarMenuButton
      className={cn("sidebar-menu-sub-button", className)}
      {...props}
    />
  );
}
