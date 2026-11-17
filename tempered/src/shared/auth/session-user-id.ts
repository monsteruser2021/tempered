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
