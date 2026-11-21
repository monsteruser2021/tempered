"use client";

import { useMemo, useState } from "react";
import { Check, Dumbbell, Moon, Save, X } from "lucide-react";
import RoutineDayEditor from "./RoutineDayEditor";
import type { Routine, RoutineDay } from "../types/mawina.types";

const weekdays = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

type Props = {
  routine: Routine;
  saving: boolean;
  onClose: () => void;
  onSaveDays: (routineId: string, days: RoutineDay[]) => Promise<void>;
};

export default function RoutineDetailView({ routine, saving, onClose, onSaveDays }: Props) {
  const [days, setDays] = useState(routine.days);
  const [selectedDayId, setSelectedDayId] = useState(
    () => routine.days.find((day) => !day.isRestDay)?.id ?? "",
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const selectedDay = useMemo(() => days.find((day) => day.id === selectedDayId) ?? null, [days, selectedDayId]);
  const activeDays = days.filter((day) => !day.isRestDay).length;
  const restDays = routine.scheduleType === "fixed_days" ? 7 - activeDays : days.length - activeDays;
  const dayEntries = routine.scheduleType === "fixed_days"
    ? weekdays.map((weekday, index) => {
      const routineDayIndex = routine.fixedDays?.indexOf(weekday.value) ?? -1;
      const routineDay = routineDayIndex >= 0 ? days[routineDayIndex] : undefined;
      const dayNumber = routineDay?.dayNumber ?? index + 1;
      return {
        id: routineDay?.id ?? `rest-weekday-${weekday.value}`,
        day: routineDay ?? {
          id: `rest-weekday-${weekday.value}`,
          dayNumber,
          title: `${weekday.label} · Descanso`,
          isRestDay: true,
          exercises: [],
        },
        label: weekday.label,
      };
    })
    : days.map((day) => ({ id: day.id, day, label: `Día ${day.dayNumber}` }));

  const updateDay = (updatedDay: RoutineDay) => {
    setDays((current) => current.map((day) => day.id === updatedDay.id ? updatedDay : day));
    setDirty(true);
    setError("");
  };

  const requestClose = () => {
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?")) return;
    onClose();
  };

  const save = async () => {
    setError("");
    try {
      await onSaveDays(routine.id, days);
      setDirty(false);
    } catch (saveError) {
      console.error("Error al guardar ejercicios de la rutina:", saveError);
      setError("No se pudieron guardar los cambios. Inténtalo de nuevo.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="routine-detail-title" className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[#d1a84b]/35 bg-[#151515] text-white shadow-2xl shadow-black/60">
        <header className="flex flex-col gap-4 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#d1a84b]">Detalle y ejercicios</p>
            <h3 id="routine-detail-title" className="mt-2 wrap-break-word text-lg uppercase sm:text-xl">{routine.name}</h3>
            <p className="mt-2 text-[10px] text-white/45">{activeDays} días activos · {restDays} días de descanso · {routine.days.length} bloques en total</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={!dirty || saving} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#d1a84b] px-4 py-2 text-[10px] font-bold uppercase text-[#17130b] transition hover:bg-[#e6c46f] focus:outline-none focus:ring-2 focus:ring-white disabled:cursor-not-allowed disabled:opacity-45">
              {dirty ? <Save aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}
              {saving ? "Guardando..." : dirty ? "Guardar rutina" : "Guardado"}
            </button>
            <button type="button" onClick={requestClose} aria-label="Cerrar detalle de rutina" className="flex size-10 items-center justify-center rounded-lg border border-white/15 text-white/60 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#d1a84b]">
              <X aria-hidden="true" size={17} />
            </button>
          </div>
        </header>

        {error && <p role="alert" className="mx-4 mt-4 rounded-lg border border-red-300/30 bg-red-950/30 p-3 text-xs text-red-100 sm:mx-6">{error}</p>}
        {dirty && <p role="status" className="px-4 pt-3 text-[10px] text-[#e2c47d] sm:px-6">Hay cambios sin guardar en esta rutina.</p>}

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(13rem,0.32fr)_minmax(0,0.68fr)]">
          <nav aria-label="Días de la rutina" className="border-b border-white/10 p-4 md:border-b-0 md:border-r md:p-5">
            <p className="mb-3 text-[10px] uppercase tracking-[0.16em] text-white/40">Bloques de la rutina</p>
            {days.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/15 p-4 text-xs leading-5 text-white/45">Esta rutina todavía no tiene días. Edita su estructura antes de añadir ejercicios.</p>
            ) : (
              <ol className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto md:max-h-full md:grid-cols-1">
                {dayEntries.map(({ id, day, label }) => (
                  <li key={id}>
                    <button
                      type="button"
                      disabled={day.isRestDay}
                      onClick={() => setSelectedDayId(day.id)}
                      aria-current={selectedDayId === day.id ? "step" : undefined}
                      className={`flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-[#d1a84b] disabled:cursor-default ${day.isRestDay ? "border-white/5 bg-white/[0.02] text-white/30" : selectedDayId === day.id ? "border-[#d1a84b]/55 bg-[#d1a84b]/10 text-white" : "border-white/10 bg-black/15 text-white/60 hover:bg-white/5"}`}
                    >
                      {day.isRestDay ? <Moon aria-hidden="true" className="shrink-0" size={14} /> : <Dumbbell aria-hidden="true" className="shrink-0 text-[#d1a84b]" size={14} />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[9px] uppercase tracking-wider">{routine.scheduleType === "fixed_days" ? label : day.isRestDay ? `Día ${day.dayNumber} · Descanso` : `Día ${day.dayNumber}`}</span>
                        <span className="mt-1 block truncate text-[10px]">{day.isRestDay ? "Recuperación" : day.title}</span>
                      </span>
                      {!day.isRestDay && <span className="shrink-0 text-[9px] text-white/35">{day.exercises.length}</span>}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </nav>

          <div className="min-w-0 p-4 sm:p-6">
            {selectedDay ? (
              <>
                <div className="mb-5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[#d1a84b]">Día activo {selectedDay.dayNumber}</p>
                  <h4 className="mt-2 wrap-break-word text-lg uppercase text-white">{selectedDay.title}</h4>
                  <p className="mt-2 text-[10px] leading-5 text-white/40">Configura los ejercicios, las series, las repeticiones y los descansos de este día.</p>
                </div>
                <RoutineDayEditor key={selectedDay.id} day={selectedDay} onChange={updateDay} />
              </>
            ) : (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-white/15 p-6 text-center">
                <Moon aria-hidden="true" className="text-white/35" size={23} />
                <p className="mt-3 text-sm text-white/65">{days.length ? "No hay días activos en esta rutina." : "Agrega días desde la configuración de la rutina."}</p>
                <p className="mt-2 max-w-sm text-[10px] leading-5 text-white/40">Los días de descanso se muestran en la lista, pero no requieren ejercicios.</p>
              </div>
            )}
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-white/10 px-4 py-3 text-[10px] text-white/35 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>Los cambios se aplican al guardar la rutina completa.</span>
          {dirty && <span className="text-[#e2c47d]">Cambios pendientes</span>}
        </footer>
      </section>
    </div>
  );
}
