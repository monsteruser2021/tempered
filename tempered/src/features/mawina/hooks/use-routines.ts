"use client";

import { useCallback, useEffect, useState } from "react";
import { getUserRoutines } from "../services/mawina.service";
import type { Routine } from "../types/mawina.types";

type RoutineResult = { userId: string; routines: Routine[]; error: string };

export function useRoutines(userId: string | null) {
  const [result, setResult] = useState<RoutineResult | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      setResult({ userId, routines: await getUserRoutines(userId), error: "" });
    } catch (loadError) {
      console.error("Error al cargar las rutinas de Mawina:", loadError);
      setResult({ userId, routines: [], error: "No se pudieron cargar tus rutinas." });
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      try {
        const routines = await getUserRoutines(userId);
        if (active) setResult({ userId, routines, error: "" });
      } catch (loadError) {
        console.error("Error al cargar las rutinas de Mawina:", loadError);
        if (active) setResult({ userId, routines: [], error: "No se pudieron cargar tus rutinas." });
      }
    })();
    return () => { active = false; };
  }, [userId]);

  const currentResult = result?.userId === userId ? result : null;
  return {
    routines: currentResult?.routines ?? [],
    loading: Boolean(userId && !currentResult),
    error: currentResult?.error ?? "",
    reload,
  };
}
