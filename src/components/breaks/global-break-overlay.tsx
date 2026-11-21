import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  LogOut,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  formatDurationHuman,
  formatOvertimeHms,
  formatTimeWithSecondsIst,
} from "@/lib/breaks/break-management";
import {
  isAlarmMuted,
  startOvertimeAlarm,
  stopOvertimeAlarm,
  toggleAlarmMute,
} from "@/lib/breaks/audio-alarm";
import { endBreak } from "@/lib/daily.functions";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@tanstack/react-router";
import type { ActiveBreakState } from "@/lib/breaks.functions";

interface GlobalBreakOverlayProps {
  activeBreak: NonNullable<ActiveBreakState>;
  onBreakEnded: () => void | Promise<void>;
}

export function GlobalBreakOverlay({
  activeBreak,
  onBreakEnded,
}: GlobalBreakOverlayProps) {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(() => typeof document !== "undefined");
  const [nowDate, setNowDate] = useState<Date>(() => new Date());
  const [busy, setBusy] = useState(false);
  const [alarmMuted, setAlarmMuted] = useState(() => isAlarmMuted());

  useEffect(() => {
    setMounted(true);
  }, []);

  // Strict page scroll lock to eliminate underlying page scroll
  useEffect(() => {
    const origHtmlOverflow = document.documentElement.style.overflow;
    const origBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = origHtmlOverflow;
      document.body.style.overflow = origBodyOverflow;
    };
  }, []);

  // 1-second live ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setNowDate(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Stats calculation
  const stats = useMemo(() => {
    const startMs = new Date(activeBreak.started_at).getTime();
    const nowMs = nowDate.getTime();

    let expectedMs: number;
    if (activeBreak.expected_end_at) {
      expectedMs = new Date(activeBreak.expected_end_at).getTime();
    } else {
      const allowedMins = activeBreak.allowed_minutes || 15;
      expectedMs = startMs + allowedMins * 60_000;
    }

    const isOvertime = nowMs > expectedMs;
    const remainingSeconds = isOvertime ? 0 : Math.max(0, Math.round((expectedMs - nowMs) / 1000));
    const overtimeSeconds = isOvertime ? Math.round((nowMs - expectedMs) / 1000) : 0;

    return {
      expectedMs,
      isOvertime,
      remainingSeconds,
      overtimeSeconds,
    };
  }, [activeBreak, nowDate]);

  // Audio alert on overtime
  useEffect(() => {
    if (stats.isOvertime) {
      if (!alarmMuted) {
        startOvertimeAlarm();
      }
    } else {
      stopOvertimeAlarm();
    }
    return () => {
      stopOvertimeAlarm();
    };
  }, [stats.isOvertime, alarmMuted]);

  const handleToggleMute = () => {
    const next = toggleAlarmMute();
    setAlarmMuted(next);
  };

  const handleEndBreak = async () => {
    setBusy(true);
    try {
      stopOvertimeAlarm();
      const res = await endBreak({ data: { id: activeBreak.id } });
      const b = (res as any)?.break;

      if (b?.return_status === "late_return" && b.overtime_seconds > 0) {
        toast.warning(
          `Break completed with ${formatDurationHuman(b.overtime_seconds)} overtime (Late Return recorded).`,
        );
      } else {
        toast.success("Break completed on time. Welcome back!");
      }

      await onBreakEnded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to end break.");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    stopOvertimeAlarm();
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  // Schedule return label
  const returnScheduleLabel = useMemo(() => {
    if (activeBreak.category === "lunch") {
      return "Scheduled return: 2:30 PM IST";
    }
    if (activeBreak.category === "short_break") {
      return "Scheduled return: 5:00 PM IST";
    }
    return `Scheduled return: ${formatTimeWithSecondsIst(activeBreak.expected_end_at)}`;
  }, [activeBreak]);

  // Break Title
  const breakTitle = useMemo(() => {
    if (activeBreak.category === "lunch") return "LUNCH BREAK";
    if (activeBreak.category === "short_break") return "SHORT BREAK";
    return "PERSONALIZED BREAK";
  }, [activeBreak.category]);

  // Formatted countdown string (MM:SS or HH:MM:SS)
  const formattedCountdown = useMemo(() => {
    const s = stats.remainingSeconds;
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;

    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [stats.remainingSeconds]);

  const currentIstTime = formatTimeWithSecondsIst(nowDate.toISOString());

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  const overlayDom = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${breakTitle} - In Progress`}
      id="the-ai-school-global-break-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100dvh",
        zIndex: 2147483647,
        backgroundColor: "#050505",
        color: "#ffffff",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "clamp(1.25rem, 4vw, 3rem)",
        userSelect: "none",
        boxSizing: "border-box",
      }}
    >
      {/* Top Header: Brand Name + Live Clock + Mute */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <div
            style={{
              width: "2rem",
              height: "2rem",
              borderRadius: "0.5rem",
              backgroundColor: "rgba(220, 38, 38, 0.2)",
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              fontWeight: 900,
              fontSize: "0.75rem",
              letterSpacing: "0.05em",
            }}
          >
            TAS
          </div>
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(255, 255, 255, 0.7)",
            }}
          >
            THE AI SCHOOL
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Live IST Wall-Clock */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.25rem 0.75rem",
              borderRadius: "9999px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              fontSize: "0.75rem",
              fontFamily: "monospace",
              color: "rgba(255, 255, 255, 0.8)",
            }}
          >
            <Clock style={{ width: "0.875rem", height: "0.875rem", opacity: 0.6 }} />
            <span>{currentIstTime} IST</span>
          </div>

          {/* Sound Mute Toggle */}
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={alarmMuted ? "Unmute overtime alert sound" : "Mute overtime alert sound"}
            title={alarmMuted ? "Overtime chime is muted. Click to unmute." : "Click to mute overtime chime."}
            style={{
              width: "2.25rem",
              height: "2.25rem",
              borderRadius: "0.5rem",
              border: alarmMuted ? "1px solid rgba(255, 255, 255, 0.15)" : "1px solid rgba(239, 68, 68, 0.4)",
              backgroundColor: alarmMuted ? "rgba(255, 255, 255, 0.05)" : "rgba(239, 68, 68, 0.15)",
              color: alarmMuted ? "rgba(255, 255, 255, 0.5)" : "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {alarmMuted ? <VolumeX style={{ width: "1rem", height: "1rem" }} /> : <Volume2 style={{ width: "1rem", height: "1rem" }} />}
          </button>
        </div>
      </header>

      {/* Main Center Stage: Vertically & Horizontally Centered */}
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          margin: "auto 0",
          width: "100%",
        }}
      >
        {/* Brand Header */}
        <p
          style={{
            fontSize: "clamp(0.875rem, 2vw, 1.125rem)",
            fontWeight: 800,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(255, 255, 255, 0.7)",
            margin: 0,
            marginBottom: "0.75rem",
          }}
        >
          THE AI SCHOOL
        </p>

        {/* Large Red Break Title */}
        {stats.isOvertime ? (
          <h1
            style={{
              fontSize: "clamp(1.75rem, 5vw, 4rem)",
              fontWeight: 900,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#ef4444",
              margin: 0,
              textShadow: "0 0 32px rgba(239, 68, 68, 0.5)",
            }}
          >
            {breakTitle} — TIME EXCEEDED
          </h1>
        ) : (
          <h1
            style={{
              fontSize: "clamp(2rem, 6vw, 4.5rem)",
              fontWeight: 900,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#ef4444",
              margin: 0,
              textShadow: "0 0 32px rgba(239, 68, 68, 0.4)",
            }}
          >
            {breakTitle}
          </h1>
        )}

        {/* Huge Centered Monospace Countdown Timer */}
        <div
          style={{
            margin: "clamp(1.5rem, 4vh, 3rem) 0",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: "clamp(3.5rem, 12vw, 8.5rem)",
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: stats.isOvertime ? "#ef4444" : "#ffffff",
            fontVariantNumeric: "tabular-nums",
            textShadow: stats.isOvertime ? "0 0 40px rgba(239, 68, 68, 0.6)" : "none",
          }}
          aria-live={stats.isOvertime ? "assertive" : "polite"}
        >
          {stats.isOvertime ? formatOvertimeHms(stats.overtimeSeconds) : formattedCountdown}
        </div>

        {/* Scheduled Return / Overtime Note */}
        {stats.isOvertime ? (
          <p
            style={{
              fontSize: "clamp(0.875rem, 2vw, 1.25rem)",
              fontWeight: 600,
              color: "#fca5a5",
              margin: 0,
              marginBottom: "clamp(1.5rem, 3vh, 2.5rem)",
            }}
          >
            You have exceeded your scheduled break time.
          </p>
        ) : (
          <p
            style={{
              fontSize: "clamp(0.875rem, 2vw, 1.25rem)",
              fontWeight: 600,
              color: "rgba(255, 255, 255, 0.7)",
              margin: 0,
              marginBottom: "clamp(1.5rem, 3vh, 2.5rem)",
            }}
          >
            {returnScheduleLabel}
          </p>
        )}

        {/* Large Red End Break Action Button */}
        <button
          type="button"
          onClick={handleEndBreak}
          disabled={busy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            width: "100%",
            maxWidth: "340px",
            padding: "1rem 2rem",
            borderRadius: "0.75rem",
            backgroundColor: "#dc2626",
            color: "#ffffff",
            fontSize: "clamp(1rem, 2vw, 1.125rem)",
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            border: "none",
            cursor: busy ? "not-allowed" : "pointer",
            boxShadow: "0 10px 25px -5px rgba(220, 38, 38, 0.5), 0 8px 10px -6px rgba(220, 38, 38, 0.5)",
            transition: "all 0.15s ease",
            opacity: busy ? 0.7 : 1,
          }}
        >
          <CheckCircle2 style={{ width: "1.25rem", height: "1.25rem" }} />
          <span>
            {busy
              ? "Confirming Return..."
              : stats.isOvertime
                ? "END BREAK & RETURN TO WORK"
                : "END BREAK"}
          </span>
        </button>
      </main>

      {/* Bottom Footer: Policy Note + Emergency Sign Out */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          fontSize: "0.75rem",
          color: "rgba(255, 255, 255, 0.4)",
        }}
      >
        <span>Break will not end automatically. Click End Break to return to work.</span>

        {/* Emergency Sign Out */}
        <button
          type="button"
          onClick={handleSignOut}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            background: "none",
            border: "none",
            color: "rgba(255, 255, 255, 0.4)",
            cursor: "pointer",
            fontSize: "0.75rem",
            padding: "0.25rem 0.5rem",
            borderRadius: "0.25rem",
          }}
        >
          <LogOut style={{ width: "0.875rem", height: "0.875rem" }} />
          <span>Sign out</span>
        </button>
      </footer>
    </div>
  );

  return createPortal(overlayDom, document.body);
}
