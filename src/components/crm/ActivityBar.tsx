"use client";
import { useRequestsPending } from "./activity";

// Decorative only: screen readers already get busy-button text and role="status" regions.
// The CSS delays showing it, so requests that finish almost instantly never flash it.
export function ActivityBar() {
  const active = useRequestsPending();
  return (
    <div className="crm-activity-bar" data-active={active} aria-hidden="true">
      <span />
    </div>
  );
}
