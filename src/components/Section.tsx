import type { ReactNode } from "react";

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`studio-section border-t border-hairline ${className}`}
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">{children}</div>
    </section>
  );
}

