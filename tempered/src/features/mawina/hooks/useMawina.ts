"use client";

import { useCallback, useState } from "react";
import {
  completeWorkoutSession as saveWorkoutSession,
  advanceRoutineCycle,
  createRoutine,
  deleteRoutine,
  setRoutineActive,
  setRoutineCycleIndex,
  updateRoutine,
} from "../services/mawina.service";
import { useRoutines } from "./use-routines";
import { useWorkoutHistory } from "./use-workout-history";
import type { RoutineConfiguration, RoutineDay, WorkoutSession } from "../types/mawina.types";

export function useMawina(userId: string | null) {
  const {
    routines,
    loading: routinesLoading,
    error: routinesError,
    reload: reloadRoutines,
  } = useRoutines(userId);
  const {
    sessions,
    loading: historyLoading,
    loadingMore: historyLoadingMore,
    refreshing: historyRefreshing,
    hasMore: historyHasMore,
    metrics: historyMetrics,
    error: historyError,
    reload: reloadHistory,
    loadMore: loadMoreHistory,
  } = useWorkoutHistory(userId);
  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationError, setMutationError] = useState("");

  const runMutation = useCallback(async <T,>(
    label: string,
    fallback: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    setMutationLoading(true);
    setMutationError("");
    try {
      return await operation();
    } catch (error) {
      console.error(label, error);
      setMutationError(fallback);
      throw error;
    } finally {
      setMutationLoading(false);
    }
  }, []);

  const saveRoutine = useCallback(async (
    configuration: RoutineConfiguration,
    routineId?: string,
  ) => {
    if (!userId) throw new Error("No hay una sesión activa para guardar la rutina.");
    await runMutation("Error al guardar una rutina de Mawina:", "No se pudo guardar la rutina.", async () => {
      if (routineId) {
        await updateRoutine(userId, routineId, configuration);
      } else {
        await createRoutine({
          ...configuration,
          userId,
          currentCycleIndex: 0,
          isActive: routines.length === 0,
        });
      }
      await reloadRoutines();
    });
  }, [reloadRoutines, routines.length, runMutation, userId]);

  const changeRoutineStatus = useCallback(async (routineId: string, isActive: boolean) => {
    if (!userId) throw new Error("No hay una sesión activa para actualizar la rutina.");
    await runMutation(
      "Error al cambiar el estado de una rutina de Mawina:",
      "No se pudo actualizar el estado de la rutina.",
      async () => {
        await setRoutineActive(userId, routineId, isActive);
        await reloadRoutines();
      },
    );
  }, [reloadRoutines, runMutation, userId]);

  const saveRoutineDays = useCallback(async (routineId: string, days: RoutineDay[]) => {
    if (!userId) throw new Error("No hay una sesión activa para guardar los días de la rutina.");
    await runMutation(
      "Error al guardar los días de una rutina de Mawina:",
      "No se pudieron guardar los ejercicios de la rutina.",
      async () => {
        await updateRoutine(userId, routineId, { days });
        await reloadRoutines();
      },
    );
  }, [reloadRoutines, runMutation, userId]);

  const removeRoutine = useCallback(async (routineId: string) => {
    if (!userId) throw new Error("No hay una sesión activa para eliminar la rutina.");
    await runMutation(
      "Error al eliminar una rutina de Mawina:",
      "No se pudo eliminar la rutina.",
      async () => {
        await deleteRoutine(userId, routineId);
        await reloadRoutines();
      },
    );
  }, [reloadRoutines, runMutation, userId]);

  const advanceCycle = useCallback(async (routineId: string) => {
    if (!userId) throw new Error("No hay una sesión activa para avanzar el ciclo.");
    await runMutation(
      "Error al avanzar el ciclo de Mawina:",
      "No se pudo avanzar el ciclo.",
      async () => {
        await advanceRoutineCycle(userId, routineId);
        await reloadRoutines();
      },
    );
  }, [reloadRoutines, runMutation, userId]);

  const setCycleDay = useCallback(async (routineId: string, cycleIndex: number) => {
    if (!userId) throw new Error("No hay una sesión activa para ajustar el ciclo.");
    await runMutation(
      "Error al ajustar el día del ciclo de Mawina:",
      "No se pudo ajustar el día del ciclo.",
      async () => {
        await setRoutineCycleIndex(userId, routineId, cycleIndex);
        await reloadRoutines();
      },
    );
  }, [reloadRoutines, runMutation, userId]);

  const completeWorkout = useCallback(async (session: Omit<WorkoutSession, "id">) => {
    if (!userId || session.userId !== userId) throw new Error("La sesión de entrenamiento no coincide con el usuario activo.");
    await runMutation(
      "Error al guardar la sesión de Mawina:",
      "No se pudo guardar la sesión. Tu progreso no se modificó; vuelve a intentarlo.",
      async () => {
        await saveWorkoutSession(session);
        await Promise.all([reloadRoutines(), reloadHistory()]);
      },
    );
  }, [reloadHistory, reloadRoutines, runMutation, userId]);

  return {
    routines,
    sessions,
    historyMetrics,
    routinesLoading,
    historyLoading,
    historyLoadingMore,
    historyRefreshing,
    historyHasMore,
    mutationLoading,
    error: mutationError || routinesError,
    historyError,
    reloadRoutines,
    reloadHistory,
    loadMoreHistory,
    saveRoutine,
    saveRoutineDays,
    changeRoutineStatus,
    removeRoutine,
    advanceCycle,
    setCycleDay,
    completeWorkout,
  };
}
