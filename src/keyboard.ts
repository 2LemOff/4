import { useEffect, useState } from "react";
import { settingsStore, useStore } from "./store";

const KB_KEY = "fractal.keyboardHeight";
const typing = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "checkbox"));
};

/** The keyboard's height from last time (so a layout can make room before it opens). */
export function lastKeyboardHeight(): number {
  try {
    return Number(localStorage.getItem(KB_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Whether the on-screen keyboard is up. The viewport asks Chrome to make the app shorter above the keyboard
 * (`interactive-widget=resizes-content`) instead of sliding the page up. Where a browser still only shrinks the
 * visual viewport, the app is pinned to it (`--app-h`, `--app-shift`) so nothing slides off the top. In
 * "overlay" mode (Settings) the keyboard covers the screen and only the question box rises above it.
 */
export function useKeyboard(): boolean {
  const { keyboardMode } = useStore(settingsStore);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vk = (navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean } }).virtualKeyboard;
    if (vk) vk.overlaysContent = keyboardMode === "overlay";
    const vv = window.visualViewport;
    if (!vv) return;
    let full = Math.max(window.innerHeight, vv.height);
    const root = document.documentElement.style;
    const update = () => {
      if (!typing()) full = Math.max(window.innerHeight, vv.height);
      const kb = full - vv.height;
      const up = typing() && kb > 120;
      setOpen(up);
      if (up) {
        try {
          localStorage.setItem(KB_KEY, String(Math.round(kb)));
        } catch {
          /* storage may be unavailable */
        }
      }
      // fallback: the layout didn't shrink, only the visible part did, so follow the visible part
      const panned = keyboardMode !== "overlay" && window.innerHeight - vv.height > 120;
      if (panned) {
        root.setProperty("--app-h", `${Math.round(vv.height)}px`);
        root.setProperty("--app-shift", `${Math.round(vv.offsetTop)}px`);
      } else {
        root.removeProperty("--app-h");
        root.removeProperty("--app-shift");
      }
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.removeProperty("--app-h");
      root.removeProperty("--app-shift");
    };
  }, [keyboardMode]);
  return open;
}
