import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-foreground text-background shadow-xs hover:bg-foreground/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-destructive/35 bg-destructive/12 text-destructive dark:border-destructive/45 dark:bg-destructive/20",
        success:
          "border-emerald-500/35 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
        warning:
          "border-amber-500/40 bg-amber-500/12 text-amber-900 dark:text-amber-300",
        info:
          "border-sky-500/35 bg-sky-500/12 text-sky-800 dark:text-sky-300",
        neutral: "border-border bg-muted text-muted-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
