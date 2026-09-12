import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

const base =
  "inline-flex items-center justify-center gap-3 rounded-md font-sans text-sm leading-5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const variants = {
  primary: "bg-primary text-on-primary border border-primary px-5 py-3 hover:bg-ink-hover",
  outline:
    "bg-transparent text-ink border border-white/25 px-4 py-2.5 hover:border-white/50",
  "outline-sm":
    "bg-transparent text-ink border border-white/25 px-3.5 py-1.5 text-[13px] hover:border-white/50",
} as const;

type Variant = keyof typeof variants;

export function ButtonLink({
  variant = "outline",
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return (
    <a className={`${base} ${variants[variant]} ${className}`} {...props} />
  );
}

export function Button({
  variant = "outline",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props} />
  );
}

