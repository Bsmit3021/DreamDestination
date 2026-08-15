import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A native `<select>` styled to match the shadcn/ui inputs.
 *
 * Chosen over the Radix Select on purpose: this submits its value with the
 * enclosing form without any JavaScript, gives screen readers and mobile
 * browsers their built-in picker, and keeps the onboarding forms working
 * before hydration.
 */
function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "flex h-9 w-full appearance-none rounded-lg border border-border bg-background bg-[length:1.25rem] bg-[right_0.5rem_center] bg-no-repeat px-3 py-1 pr-9 text-sm shadow-xs transition-colors outline-none",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke-width=%221.5%22 stroke=%22%23888%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22m19.5 8.25-7.5 7.5-7.5-7.5%22/%3E%3C/svg%3E')]",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { NativeSelect };
