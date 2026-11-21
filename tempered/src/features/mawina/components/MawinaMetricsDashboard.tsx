"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, Clock3, Dumbbell, Flame, RotateCcw } from "lucide-react";
import type { WorkoutSession } from "../types/mawina.types";

type Props = {
  sessions: WorkoutSession[];
  metrics: {
    currentStreakDays: number;
    totalSessions: number;
    totalDurationSeconds: number;
  } | null;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  hasMore: boolean;
  error: string;
  onRefresh: () => void;
  onLoadMore: () => void;
};

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}

function formatSessionDate(date: Date): string {
  return date.toLocaleString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SessionDetails({ session }: { session: WorkoutSession }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <details
      className="group rounded-xl border border-white/10 bg-black/25 transition open:border-[#d87979]/35"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d87979] sm:px-5">
        <span className="min-w-0">
          <span className="block text-sm text-white">{session.dayTitle}</span>
          <span className="mt-1 block text-xs text-white/45">
            {session.routineName} · {formatSessionDate(session.date)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="text-xs tabular-nums text-[#e5a0a0]">{formatDuration(session.durationSeconds)}</span>
          <ChevronDown
            aria-hidden="true"
            size={16}
            className={`text-white/45 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </span>
      </summary>
      <div className="border-t border-white/10 px-4 pb-4 pt-3 sm:px-5">
        {session.completedExercises.some((exercise) => exercise.sets.length > 0) ? (
          <ul className="space-y-3">
            {session.completedExercises.filter((exercise) => exercise.sets.length > 0).map((exercise) => (
              <li key={exercise.exerciseId}>
                <h4 className="text-xs font-medium text-white/80">{exercise.name}</h4>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {exercise.sets.map((set) => (
                    <li
                      key={`${exercise.exerciseId}-${set.setNumber}`}
                      className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2 text-[11px]"
                    >
                      <span className="text-white/45">Serie {set.setNumber}</span>
                      <span className="tabular-nums text-white/75">{set.weight} kg · {set.reps} reps</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-white/45">No se registraron series completadas en esta sesión.</p>
        )}
      </div>
    </details>
  );
}

export default function MawinaMetricsDashboard({
  sessions,
  metrics,
  loading,
  loadingMore,
  refreshing,
  hasMore,
  error,
  onRefresh,
  onLoadMore,
}: Props) {
  const metricCards = [
    {
      label: "Racha actual",
      value: metrics ? `${metrics.currentStreakDays} días` : "—",
      detail: "Días consecutivos con entrenamiento",
      icon: Flame,
    },
    {
      label: "Sesiones completadas",
      value: metrics ? metrics.totalSessions.toLocaleString("es") : "—",
      detail: "Total histórico",
      icon: Dumbbell,
    },
    {
      label: "Tiempo acumulado",
      value: metrics ? formatDuration(metrics.totalDurationSeconds) : "—",
      detail: "En todas tus sesiones",
      icon: Clock3,
    },
  ];

  return (
    <section className="mt-7" aria-labelledby="history-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[#e5a0a0]">Constancia que se construye</p>
          <h2 id="history-title" className="mt-2 text-xl uppercase text-white">Métricas e historial</h2>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || loading || loadingMore}
          className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-white/15 px-3 py-2 text-[10px] uppercase text-white/60 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          <RotateCcw aria-hidden="true" size={14} className={refreshing ? "animate-spin" : ""} />
          Actualizar
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {metricCards.map(({ label, value, detail, icon: Icon }) => (
          <article key={label} className="rounded-xl border border-white/10 bg-black/30 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-wider text-white/45">{label}</p>
              <Icon aria-hidden="true" size={16} className="text-[#e5a0a0]/75" />
            </div>
            <p className="mt-4 text-2xl tabular-nums text-white">{loading ? "…" : value}</p>
            <p className="mt-2 text-[10px] text-white/40">{detail}</p>
          </article>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-5 rounded-xl border border-red-300/40 bg-red-950/40 p-4 text-sm text-red-100">
          {error}
        </p>
      )}

      <div className="mt-7">
        <div className="flex items-center gap-2">
          <CalendarDays aria-hidden="true" size={16} className="text-[#e5a0a0]" />
          <h3 className="text-sm uppercase tracking-wide text-white/75">Bitácora de entrenamiento</h3>
        </div>

        {loading && sessions.length === 0 ? (
          <p role="status" className="mt-4 rounded-xl border border-white/10 bg-black/20 p-5 text-sm text-white/50">
            Cargando tus sesiones...
          </p>
        ) : sessions.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/20 p-6 text-center">
            <p className="text-sm text-white/65">Todavía no hay sesiones registradas.</p>
            <p className="mt-2 text-xs text-white/40">Al completar tu primer entrenamiento, aparecerá aquí.</p>
          </div>
        ) : (
          <>
            <ul className="mt-4 space-y-2">
              {sessions.map((session) => (
                <li key={session.id}>
                  <SessionDetails session={session} />
                </li>
              ))}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore || refreshing}
                className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-xs uppercase text-white/65 transition hover:border-[#d87979]/40 hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? "Cargando sesiones..." : "Ver sesiones anteriores"}
                {!loadingMore && <ChevronDown aria-hidden="true" size={15} />}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
