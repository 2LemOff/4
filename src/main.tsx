import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { recoverInterrupted } from "./ai";
import { exchangeCode } from "./openrouter";
import { initApp, updateSettings } from "./store";
import { resumePending } from "./synthesis";
import { resumeStories } from "./stories";
import { resumeVisuals } from "./visuals";
import "./styles.css";

/** Finish the OpenRouter sign-in when it redirects back with ?code=… */
async function finishSignIn() {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) return;
  const verifier = sessionStorage.getItem("pkce_verifier");
  history.replaceState(null, "", location.pathname + "#/settings/account");
  if (!verifier) return;
  sessionStorage.removeItem("pkce_verifier");
  try {
    updateSettings({ apiKey: await exchangeCode(code, verifier) });
  } catch (e) {
    alert(`Sign-in failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function boot() {
  await initApp();
  await finishSignIn();
  await recoverInterrupted();
  void resumePending();
  void resumeStories();
  void resumeVisuals();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  registerSW({ immediate: true });
}
void boot();
