import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listMyNotifications, markNotificationRead } from "@/lib/daily.functions";
import { Button } from "@/components/ui/button";
import { ORG_TIMEZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: notifications = [] } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: () => listMyNotifications(),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const unread = notifications.filter((n) => !n.read_at);

  async function read(id: string) {
    try {
      setBusyId(id);
      await markNotificationRead({ data: { id } });
      await queryClient.invalidateQueries({ queryKey: ["my-notifications"] });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="size-5" aria-hidden="true" />
        {unread.length > 0 ? (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        ) : null}
      </Button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Notifications"
            className="fixed right-3 z-50 mt-2 max-h-[min(24rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-border bg-popover p-2 shadow-lg sm:absolute sm:right-0"
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Notifications
              </p>
              {unread.length > 0 ? (
                <span className="text-[11px] font-medium text-primary">
                  {unread.length} unread
                </span>
              ) : null}
            </div>
            {notifications.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                You're all caught up.
              </p>
            ) : null}
            {notifications.slice(0, 25).map((n) => (
              <button
                key={n.id}
                type="button"
                disabled={busyId === n.id}
                onClick={() => read(n.id)}
                className={cn(
                  "block w-full cursor-pointer rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                  !n.read_at && "bg-accent/55",
                )}
              >
                <span className="block break-words font-medium leading-snug">{n.title}</span>
                {n.body ? (
                  <span className="mt-0.5 line-clamp-2 block break-words text-xs text-muted-foreground">
                    {n.body}
                  </span>
                ) : null}
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {new Date(n.created_at).toLocaleString("en-IN", {
                    timeZone: ORG_TIMEZONE,
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
