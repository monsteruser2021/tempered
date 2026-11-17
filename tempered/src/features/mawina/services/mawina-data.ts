export type MawinaRoutine = {
  id: string;
  userId: string;
  title: string;
  category: string;
  duration: string;
  days: number[];
  completedDates: string[];
};

export const mawinaWeekDays = [
  { value: 1, shortLabel: "L", label: "Lunes" },
  { value: 2, shortLabel: "Ma", label: "Martes" },
  { value: 3, shortLabel: "Mi", label: "Miércoles" },
  { value: 4, shortLabel: "J", label: "Jueves" },
  { value: 5, shortLabel: "V", label: "Viernes" },
  { value: 6, shortLabel: "S", label: "Sábado" },
  { value: 0, shortLabel: "D", label: "Domingo" },
];

export function mawinaDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isRoutineScheduledToday(routine: MawinaRoutine, date = new Date()) {
  return routine.days.includes(date.getDay());
}