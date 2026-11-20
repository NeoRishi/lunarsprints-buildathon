"use client";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
export function Button({
  children,
  secondary = false,
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  secondary?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`${secondary ? "button secondary" : "button"} ${props.className ?? ""}`}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function NextButton({
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button {...props}>
      {children}
      <ArrowRight size={16} />
    </Button>
  );
}
export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="checks">
      {items.map((t, i) => (
        <li key={i}>
          <Check size={15} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
export function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="section-heading">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
export function Notice({
  children,
  warning = false,
}: {
  children: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={warning ? "notice warning" : "notice"}>{children}</div>
  );
}
