"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  DEFAULT_PLANNER_ALERT_THRESHOLDS,
  PLANNER_ALERT_THRESHOLDS_EVENT,
  plannerAlertStorageKey,
  readPlannerAlertThresholds,
} from "@/lib/planner-health";

const getServerSnapshot = () => null;

export function usePlannerAlertThresholds(userId: string | null) {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!userId) return () => {};
    const storageKey = plannerAlertStorageKey(userId);
    const onStorage = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== storageKey) return;
      onStoreChange();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PLANNER_ALERT_THRESHOLDS_EVENT, onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PLANNER_ALERT_THRESHOLDS_EVENT, onStorage);
    };
  }, [userId]);

  const getSnapshot = useCallback(() => {
    if (!userId) return null;
    try {
      return window.localStorage.getItem(plannerAlertStorageKey(userId));
    } catch (error) {
      console.error("No se pudieron leer los umbrales de alerta del Planificador:", error);
      return null;
    }
  }, [userId]);

  const storedValue = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(
    () => storedValue === null
      ? DEFAULT_PLANNER_ALERT_THRESHOLDS
      : readPlannerAlertThresholds(storedValue),
    [storedValue],
  );
}
