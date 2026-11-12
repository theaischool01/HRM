import logoUrl from "@/assets/the-ai-school-logo.png";
import logoOnDarkUrl from "@/assets/the-ai-school-logo-on-dark.png";
import { cn } from "@/lib/utils";

/**
 * Official The AI School logo.
 *
 * - `variant="dark"` (default): original supplied asset — red "AI SCHOOL",
 *   black "THE" — for light backgrounds.
 * - `variant="light"`: approved dark-background variant generated from the same
 *   source (scripts/build-logo-on-dark.py) — identical red artwork, only "THE"
 *   turned white, transparent background.
 *
 * Never recolour the logo with CSS filters (invert/hue-rotate turn the brand
 * red into cyan).
 */
export function Logo({
  className,
  variant = "dark",
}: {
  className?: string;
  variant?: "dark" | "light";
}) {
  return (
    <img
      src={variant === "light" ? logoOnDarkUrl : logoUrl}
      alt="The AI School"
      decoding="async"
      draggable={false}
      className={cn("h-8 w-auto max-w-full select-none object-contain", className)}
    />
  );
}

export function WordMark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Logo />
      <div className="leading-tight">
        <p className="font-display text-sm font-semibold tracking-tight">HRM Portal</p>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  );
}
