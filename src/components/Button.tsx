import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  block?: boolean;
  children: ReactNode;
};

export default function Button({ variant = "secondary", block, className = "", children, ...rest }: Props) {
  const classes = ["btn", `btn--${variant}`, block ? "btn--block" : "", className].filter(Boolean).join(" ");
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
