"use client";

import { useState } from "react";
import { CalendarDays, ChevronRight, Dumbbell, Moon, Plus } from "lucide-react";
import WorkoutExecutionView from "./WorkoutExecutionView";
import type { Routine, RoutineDay, WorkoutSession } from "../types/mawina.types";

type Props = {
  userId: string | null;
  routine: Routine | null;
  hasRoutines: boolean;
  loading: boolean;
  saving: boolean;
  onCreate: () => void;
  onManageRoutines: () => void;
  onAdvanceCycle: (routineId: string) => Promise<void>;
  onSetCycleDay: (routineId: string, cycleIndex: number) => Promise<void>;
  onFinishWorkout: (session: Omit<WorkoutSession, "id">) => Promise<void>;
};

function getTodayRoutineDay(routine: Routine, date: Date): RoutineDay | null {
  if (!routine.days.length) return null;
  if (routine.scheduleType === "fixed_days") {
    const weekdayIndex = routine.fixedDays?.indexOf(date.getDay()) ?? -1;
    if (weekdayIndex < 0) {
      return {
        id: "fixed-rest-day",
        dayNumber: 0,
        title: "Día de descanso",
        isRestDay: true,
        exercises: [],
      };
    }
    return routine.days[weekdayIndex] ?? null;
  }
  const index = routine.currentCycleIndex % routine.days.length;
  return routine.days[index];
}

export default function ActiveRoutineDashboard({
  userId,
  routine,
  hasRoutines,
  loading,
  saving,
  onCreate,
  onManageRoutines,
  onAdvanceCycle,
  onSetCycleDay,
  onFinishWorkout,
}: Props) {
  const [training, setTraining] = useState(false);
  const today = new Date();
  const currentDay = routine ? getTodayRoutineDay(routine, today) : null;
  const currentIndex = routine?.days.length ? routine.currentCycleIndex % routine.days.length : 0;

  if (loading) {
    return <p role="status" className="mt-7 rounded-2xl border border-white/10 bg-black/25 p-6 text-sm text-white/60">Cargando tu rutina...</p>;
  }

  if (!routine) {
    return (
      <section className="mt-7 rounded-3xl border border-dashed border-[#d87979]/45 bg-linear-to-br from-[#620404]/25 via-black/30 to-black/20 px-6 py-12 text-center sm:px-12 sm:py-16">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-[#d87979]/40 bg-[#620404]/35 text-[#f0b5b5]">
          {hasRoutines ? <CalendarDays aria-hidden="true" size={25} /> : <Dumbbell aria-hidden="true" size={25} />}
        </span>
        <p className="mt-6 text-xs uppercase tracking-[0.18em] text-[#e5a0a0]">{hasRoutines ? "Tu biblioteca está lista" : "Tu siguiente paso empieza aquí"}</p>
        <h2 className="mt-3 text-xl uppercase text-white sm:text-2xl">{hasRoutines ? "No hay una rutina activa" : "Aún no tienes una rutina"}</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-white/55">
          {hasRoutines
            ? "Activa una de tus rutinas para continuar el ciclo cuando quieras."
            : "Diseña un ciclo que se adapte a ti. Entrena, descansa y vuelve a empezar sin depender de días fijos."}
        </p>
        <button
          type="button"
          onClick={hasRoutines ? onManageRoutines : onCreate}
          className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#d87979] px-6 py-3 text-xs font-bold uppercase text-[#210000] transition hover:bg-[#edaaaa] focus:outline-none focus:ring-2 focus:ring-white"
        >
          {hasRoutines ? <CalendarDays aria-hidden="true" size={17} /> : <Plus aria-hidden="true" size={18} />}
          {hasRoutines ? "Elegir rutina" : "Crear mi primera rutina"}
        </button>
      </section>
    );
  }

  if (!currentDay) {
    return (
      <section className="mt-7 rounded-2xl border border-white/15 bg-black/25 p-6">
        <h2 className="text-lg uppercase text-white">{routine.name}</h2>
        <p className="mt-3 text-sm text-white/55">Esta rutina todavía no tiene días configurados.</p>
        <button type="button" onClick={onManageRoutines} className="mt-5 min-h-11 rounded-xl border border-white/20 px-4 py-2 text-xs uppercase text-white/70 hover:bg-white/5">Configurar rutina</button>
      </section>
    );
  }

  if (training && userId && !currentDay.isRestDay) {
    return (
      <WorkoutExecutionView
        key={`${routine.id}-${currentDay.id}`}
        userId={userId}
        routine={routine}
        day={currentDay}
        saving={saving}
        onCancel={() => setTraining(false)}
        onFinish={async (session) => {
          await onFinishWorkout(session);
          setTraining(false);
        }}
      />
    );
  }

  const advance = async () => {
    try {
      await onAdvanceCycle(routine.id);
    } catch (advanceError) {
      console.error("No se pudo avanzar el ciclo de Mawina:", advanceError);
    }
  };

  const selectDay = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    try {
      await onSetCycleDay(routine.id, Number(event.target.value));
    } catch (selectError) {
      console.error("No se pudo ajustar el ciclo de Mawina:", selectError);
    }
  };

  return (
    <section className="mt-7" aria-labelledby="active-routine-title">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(17rem,0.7fr)]">
        <article className="rounded-2xl border border-[#a94c4c]/50 bg-black/35 p-5 shadow-xl shadow-black/20 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.16em] text-[#e5a0a0]">Rutina activa</p>
              <h2 id="active-routine-title" className="mt-3 wrap-break-word text-2xl uppercase text-white sm:text-3xl">{routine.name}</h2>
              {routine.description && <p className="mt-3 text-sm leading-6 text-white/55">{routine.description}</p>}
            </div>
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-wider text-white/60">
              {routine.scheduleType === "cycle" ? "Ciclo flexible" : "Días fijos"}
            </span>
          </div>

          <div className="mt-8 rounded-2xl border border-white/10 bg-[#121212]/75 p-5 sm:p-7">
            <p className="text-xs uppercase tracking-[0.16em] text-white/45">
              {routine.scheduleType === "cycle" ? `Día ${currentDay.dayNumber} del ciclo` : today.toLocaleDateString("es", { weekday: "long" })}
            </p>
            <h3 className="mt-3 text-xl uppercase text-white sm:text-2xl">{currentDay.title}</h3>
            {currentDay.isRestDay ? (
              <>
                <span className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase text-white/55">
                  <Moon aria-hidden="true" size={14} /> Recuperar también es progresar
                </span>
                {routine.scheduleType === "cycle" && (
                  <button type="button" onClick={() => void advance()} disabled={saving} className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#d87979] px-5 py-3 text-xs font-bold uppercase text-[#210000] transition hover:bg-[#edaaaa] disabled:opacity-50 sm:w-auto">
                    <ChevronRight aria-hidden="true" size={17} />
                    {saving ? "Actualizando ciclo..." : "Completar descanso y avanzar ciclo"}
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-white/55">{currentDay.exercises.length} ejercicios planificados</p>
                {currentDay.exercises.length > 0 ? (
                  <ul className="mt-5 space-y-2">
                    {[...currentDay.exercises].sort((a, b) => a.order - b.order).map((exercise) => (
                      <li key={exercise.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-4 py-3 text-sm text-white/75">
                        <span className="min-w-0 wrap-break-word">{exercise.name}</span>
                        <span className="shrink-0 text-xs text-white/40">{exercise.sets} × {exercise.reps}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-xs leading-5 text-white/45">Aún no hay ejercicios. Puedes iniciar una sesión vacía o agregarlos desde el detalle de la rutina.</p>
                )}
                <button
                  type="button"
                  disabled={!userId}
                  onClick={() => setTraining(true)}
                  className="mt-6 min-h-12 w-full rounded-xl bg-[#d87979] px-5 py-3 text-xs font-bold uppercase text-[#210000] transition hover:bg-[#edaaaa] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                >
                  Comenzar entrenamiento
                </button>
              </>
            )}
          </div>
        </article>

        <aside className="rounded-2xl border border-white/15 bg-black/25 p-5 sm:p-7">
          <p className="text-xs uppercase tracking-[0.16em] text-white/45">Estructura del ciclo</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-2xl text-white">{routine.activeDaysCount}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-white/45">Días activos</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-2xl text-white">{routine.restDaysCount}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-white/45">Días descanso</p>
            </div>
          </div>
          {routine.scheduleType === "cycle" && (
            <>
              <div className="mt-5 flex flex-wrap gap-2" aria-label="Progreso del ciclo">
                {routine.days.map((day, index) => (
                  <span key={day.id} className={`flex size-9 items-center justify-center rounded-lg border text-xs ${index === currentIndex ? "border-[#d87979] bg-[#620404]/70 text-white" : "border-white/10 bg-white/5 text-white/40"}`}>
                    {day.isRestDay ? "R" : day.dayNumber}
                  </span>
                ))}
              </div>
              <label className="mt-6 block text-[10px] uppercase tracking-wider text-white/50">
                Ajustar día del ciclo
                <select value={currentIndex} onChange={(event) => void selectDay(event)} disabled={saving} className="mt-2 min-h-11 w-full rounded-lg border border-white/15 bg-[#121212] px-3 text-xs text-white outline-none focus:border-[#d87979] disabled:opacity-50">
                  {routine.days.map((day, index) => (
                    <option key={day.id} value={index}>{`Día ${day.dayNumber}: ${day.title}${day.isRestDay ? " (descanso)" : ""}`}</option>
                  ))}
                </select>
              </label>
              {!currentDay.isRestDay && routine.days.length > 1 && (
                <button type="button" onClick={() => void advance()} disabled={saving} className="mt-3 min-h-10 w-full rounded-lg border border-white/15 px-3 py-2 text-[10px] uppercase text-white/55 transition hover:bg-white/5 disabled:opacity-40">
                  {saving ? "Actualizando..." : "Saltar este día"}
                </button>
              )}
            </>
          )}
          {routine.scheduleType === "fixed_days" && (
            <p className="mt-5 text-[10px] leading-5 text-white/40">La rutina fija sigue el calendario semanal. Puedes editar sus días desde el gestor de rutinas.</p>
          )}
        </aside>
      </div>

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onManageRoutines} className="min-h-10 rounded-lg border border-white/15 px-4 py-2 text-[10px] uppercase text-white/50 transition hover:bg-white/5 hover:text-white/75">
          Administrar rutinas
        </button>
      </div>
    </section>
  );
}
