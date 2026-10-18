import type { ReactNode } from "react";

export default function Alert({ tone = "alert", children }: { tone?: "alert" | "danger"; children: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role="status">
      {children}
    </div>
  );
}
