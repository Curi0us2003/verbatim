import { useEffect, useState } from "react";

const KEY = "verbatim-theme";

function initialDark(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved === "dark";
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Light/dark mode: follows the system until the counsellor picks one, then remembers it. */
export function useTheme() {
  const [dark, setDark] = useState(initialDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const toggle = () =>
    setDark((d) => {
      try {
        localStorage.setItem(KEY, d ? "light" : "dark");
      } catch {
        /* storage unavailable */
      }
      return !d;
    });
  return { dark, toggle };
}
