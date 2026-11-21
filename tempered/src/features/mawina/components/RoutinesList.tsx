"use client";

import { useState } from "react";
import { CalendarDays, Check, Eye, FilePenLine, Plus, Trash2 } from "lucide-react";
import RoutineDetailView from "./RoutineDetailView";
import type { Routine, RoutineDay } from "../types/mawina.types";

type Props = {
  routines: Routine[];
  loading: boolean;
  actionLoading: boolean;
  onCreate: () => void;
  onEdit: (routine: Routine) => void;
  onSetActive: (routineId: string, isActive: boolean) => Promise<void>;
  onDelete: (routineId: string) => Promise<void>;
  onSaveDays: (routineId: string, days: RoutineDay[]) => Promise<void>;
};

function routineSchedule(routine: Routine): string {
  return routine.scheduleType === "cycle"
    ? `Ciclo: ${routine.activeDaysCount} días activos / ${routine.restDaysCount} descanso`
    : `Semana: ${routine.fixedDays?.length ?? routine.activeDaysCount} días seleccionados`;
}

export default function RoutinesList({
  routines,
  loading,
  actionLoading,
  onCreate,
  onEdit,
  onSetActive,
  onDelete,
  onSaveDays,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<Routine | null>(null);
  const [detailTarget, setDetailTarget] = useState<Routine | null>(null);
  const [actionError, setActionError] = useState("");

  const changeStatus = async (routine: Routine) => {
    setActionError("");
    try {
      await onSetActive(routine.id, !routine.isActive);
    } catch {
      setActionError("No se pudo cambiar el estado. Inténtalo de nuevo.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setActionError("");
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
      if (detailTarget?.id === deleteTarget.id) setDetailTarget(null);
    } catch {
      setActionError("No se pudo eliminar la rutina. Inténtalo de nuevo.");
    }
  };

  return (
    <section className="mt-7" aria-labelledby="routines-list-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[#d1a84b]">Tu biblioteca de entrenamiento</p>
          <h2 id="routines-list-title" className="mt-2 text-xl uppercase text-white sm:text-2xl">Mis rutinas</h2>
        </div>
        <button type="button" onClick={onCreate} disabled={loading || actionLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#d1a84b] px-5 py-3 text-xs font-bold uppercase text-[#17130b] transition hover:bg-[#e6c46f] focus:outline-none focus:ring-2 focus:ring-white disabled:cursor-not-allowed disabled:opacity-50">
          <Plus aria-hidden="true" size={16} />
          Crear rutina
        </button>
      </div>

      {actionError && <p role="alert" className="mt-4 rounded-xl border border-red-300/30 bg-red-950/30 p-3 text-xs text-red-100">{actionError}</p>}
      {loading && <p role="status" className="mt-6 rounded-xl border border-white/10 bg-black/20 p-5 text-sm text-white/55">Cargando tus rutinas...</p>}
      {!loading && routines.length === 0 && (
        <div className="mt-5 rounded-2xl border border-dashed border-[#d1a84b]/30 bg-black/20 px-5 py-9 text-center">
          <CalendarDays aria-hidden="true" className="mx-auto text-[#d1a84b]" size={25} />
          <p className="mt-4 text-sm text-white/70">Aún no tienes rutinas configuradas.</p>
          <p className="mt-2 text-xs leading-5 text-white/45">Crea un ciclo flexible y define tus días activos y de descanso.</p>
          <button type="button" onClick={onCreate} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d1a84b]/50 px-5 py-3 text-xs font-bold uppercase text-[#e2c47d] transition hover:bg-[#d1a84b]/10 focus:outline-none focus:ring-2 focus:ring-[#d1a84b]">
            <Plus aria-hidden="true" size={16} />
            Crear mi primera rutina
          </button>
        </div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {routines.map((routine) => (
          <article key={routine.id} className={`min-w-0 rounded-2xl border p-5 transition ${routine.isActive ? "border-[#d1a84b]/55 bg-[#d1a84b]/[0.07]" : "border-white/10 bg-black/25"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="wrap-break-word text-sm uppercase tracking-wide text-white">
                  <button type="button" onClick={() => setDetailTarget(routine)} className="text-left transition hover:text-[#e2c47d] focus:outline-none focus:ring-2 focus:ring-[#d1a84b]">{routine.name}</button>
                </h3>
                <p className="mt-2 text-xs leading-5 text-white/50">{routine.description || (routine.category === "fitness" ? "Entrenamiento físico" : "Hábitos / Productividad")}</p>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9px] uppercase tracking-wider ${routine.isActive ? "border-[#d1a84b]/45 bg-[#d1a84b]/10 text-[#e2c47d]" : "border-white/15 bg-white/[0.03] text-white/45"}`}>
                {routine.isActive && <Check aria-hidden="true" size={11} />}
                {routine.isActive ? "Activa" : "Inactiva"}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/8 bg-black/20 p-3">
                <p className="text-[9px] uppercase tracking-wider text-white/40">Esquema</p>
                <p className="mt-1 text-[11px] leading-5 text-white/75">{routineSchedule(routine)}</p>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/20 p-3">
                <p className="text-[9px] uppercase tracking-wider text-white/40">Días configurados</p>
                <p className="mt-1 text-[11px] text-white/75">{routine.days.length} {routine.days.length === 1 ? "día" : "días"}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/8 pt-4">
              <button type="button" onClick={() => setDetailTarget(routine)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-[10px] uppercase text-white/65 transition hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#d1a84b]">
                <Eye aria-hidden="true" size={14} /> Detalle
              </button>
              <button type="button" onClick={() => onEdit(routine)} disabled={actionLoading} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-[10px] uppercase text-white/65 transition hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#d1a84b] disabled:opacity-40">
                <FilePenLine aria-hidden="true" size={14} /> Editar
              </button>
              <button type="button" onClick={() => void changeStatus(routine)} disabled={actionLoading} aria-pressed={routine.isActive} className={`min-h-10 rounded-lg border px-3 py-2 text-[10px] uppercase transition focus:outline-none focus:ring-2 focus:ring-[#d1a84b] disabled:opacity-40 ${routine.isActive ? "border-[#d1a84b]/30 text-[#e2c47d] hover:bg-[#d1a84b]/10" : "border-white/15 text-white/65 hover:bg-white/5"}`}>
                {routine.isActive ? "Desactivar" : "Activar"}
              </button>
              <button type="button" onClick={() => { setActionError(""); setDeleteTarget(routine); }} disabled={actionLoading} aria-label={`Eliminar ${routine.name}`} className="ml-auto flex min-h-10 items-center justify-center rounded-lg border border-red-200/20 px-3 py-2 text-red-100/65 transition hover:border-red-200/40 hover:bg-red-950/30 hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-40">
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {detailTarget && (
        <RoutineDetailView
          key={detailTarget.id}
          routine={detailTarget}
          saving={actionLoading}
          onClose={() => setDetailTarget(null)}
          onSaveDays={onSaveDays}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="delete-routine-title" className="w-full max-w-md rounded-2xl border border-red-200/25 bg-[#171515] p-5 shadow-2xl sm:p-6">
            <p className="text-[10px] uppercase tracking-[0.18em] text-red-200/70">Confirmación de eliminación</p>
            <h3 id="delete-routine-title" className="mt-3 text-lg uppercase text-white">¿Eliminar esta rutina?</h3>
            <p className="mt-3 text-sm leading-6 text-white/55">
              Se eliminará <span className="text-white">{deleteTarget.name}</span>. Esta acción no se puede deshacer; las sesiones del historial se conservarán.
            </p>
            {actionError && <p role="alert" className="mt-4 text-xs text-red-200">{actionError}</p>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={actionLoading} className="min-h-11 rounded-xl border border-white/15 px-4 py-3 text-xs uppercase text-white/65 hover:bg-white/5 disabled:opacity-40">Cancelar</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={actionLoading} className="min-h-11 rounded-xl bg-red-900/80 px-4 py-3 text-xs font-bold uppercase text-white transition hover:bg-red-800 disabled:opacity-50">
                {actionLoading ? "Eliminando..." : "Eliminar rutina"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
