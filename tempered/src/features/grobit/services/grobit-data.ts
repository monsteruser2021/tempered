export type Habit = {
  id: string;
  userId: string;
  name: string;
  active: boolean;
  days: number[];
};

export function readSessionUserId() {
  if (typeof document !== "undefined") {
    const cookieId = document.cookie
      .split("; ")
      .find((item) => item.startsWith("tempered_user_id="))
      ?.split("=")[1];
    if (cookieId) return decodeURIComponent(cookieId);
  }

  if (typeof window !== "undefined") {
    return window.localStorage.getItem("tempered_user_id");
  }

  return null;
}

export const weekDays = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

export function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getMonthDates(date: Date) {
  const dates: string[] = [];
  const current = new Date(date.getFullYear(), date.getMonth(), 1);

  while (current.getMonth() === date.getMonth()) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export function dayOfWeek(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

export function displayDate(dateString: string) {
  const [, month, day] = dateString.split("-");
  return `${day}/${month}`;
}