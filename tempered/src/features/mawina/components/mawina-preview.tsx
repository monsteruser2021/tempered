"use client";

import { useCallback, useMemo, useState } from "react";
import { CalendarDays, ChartNoAxesCombined, Dumbbell } from "lucide-react";
import { useSession } from "@/shared/auth/session-context";
import ActiveRoutineDashboard from "./ActiveRoutineDashboard";
import CreateRoutineModal from "./CreateRoutineModal";
import MawinaMetricsDashboard from "./MawinaMetricsDashboard";
import RoutinesList from "./RoutinesList";
import { useMawina } from "../hooks/useMawina";
import type { Routine } from "../types/mawina.types";

type DashboardTab = "active" | "routines" | "history";

export default function MawinaPreview() {
  const { userId } = useSession();
  const mawina = useMawina(userId);
  const { routines, routinesLoading } = mawina;
  const [tab, setTab] = useState<DashboardTab>("active");
  const [routineModal, setRoutineModal] = useState<{ routine?: Routine } | null>(null);
  const closeRoutineModal = useCallback(() => setRoutineModal(null), []);
  const activeRoutine = useMemo(() => routines.find((routine) => routine.isActive) ?? null, [routines]);

  const tabs: { id: DashboardTab; label: string; icon: typeof Dumbbell }[] = [
    { id: "active", label: "Mi rutina activa", icon: Dumbbell },
    { id: "routines", label: "Mis rutinas", icon: CalendarDays },
    { id: "history", label: "Métricas e historial", icon: ChartNoAxesCombined },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-white sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-[#e5a0a0]">Entrenamiento y hábitos</p>
        <h1 className="mt-3 text-3xl uppercase tracking-widest text-white sm:text-5xl">Mawina Kairos</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-white/60">
          Avanza a tu ritmo. Un ciclo flexible para construir fuerza y constancia, sesión a sesión.
        </p>
      </header>

      <nav className="grid gap-2 border-b border-white/15 pb-3 sm:grid-cols-3" aria-label="Secciones de Mawina">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs uppercase tracking-wide transition focus:outline-none focus:ring-2 focus:ring-[#e5a0a0] sm:text-sm ${tab === id ? "border border-[#d87979]/70 bg-[#620404]/45 text-white" : "border border-transparent text-white/55 hover:border-white/15 hover:bg-white/5 hover:text-white"}`}
          >
            <Icon aria-hidden="true" size={17} />
            {label}
          </button>
        ))}
      </nav>

      {mawina.error && (
        <p role="alert" className="mt-5 rounded-xl border border-red-300/40 bg-red-950/40 p-4 text-sm text-red-100">
          {mawina.error}
        </p>
      )}

      {tab === "active" && (
        <ActiveRoutineDashboard
          userId={userId}
          routine={activeRoutine}
          hasRoutines={routines.length > 0}
          loading={routinesLoading}
          saving={mawina.mutationLoading}
          onCreate={() => setRoutineModal({})}
          onManageRoutines={() => setTab("routines")}
          onAdvanceCycle={mawina.advanceCycle}
          onSetCycleDay={mawina.setCycleDay}
          onFinishWorkout={mawina.completeWorkout}
        />
      )}

      {tab === "routines" && (
        <RoutinesList
          routines={routines}
          loading={routinesLoading}
          actionLoading={mawina.mutationLoading}
          onCreate={() => setRoutineModal({})}
          onEdit={(routine) => setRoutineModal({ routine })}
          onSetActive={mawina.changeRoutineStatus}
          onDelete={mawina.removeRoutine}
          onSaveDays={mawina.saveRoutineDays}
        />
      )}

      {tab === "history" && (
        <MawinaMetricsDashboard
          sessions={mawina.sessions}
          metrics={mawina.historyMetrics}
          loading={mawina.historyLoading}
          loadingMore={mawina.historyLoadingMore}
          refreshing={mawina.historyRefreshing}
          hasMore={mawina.historyHasMore}
          error={mawina.historyError}
          onRefresh={() => void mawina.reloadHistory()}
          onLoadMore={() => void mawina.loadMoreHistory()}
        />
      )}

      {routineModal && (
        <CreateRoutineModal
          key={routineModal.routine?.id ?? "new-routine"}
          routine={routineModal.routine}
          onClose={closeRoutineModal}
          onSave={mawina.saveRoutine}
        />
      )}
    </main>
  );
}
