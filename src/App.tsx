import { useEffect, useState } from "react";
import { JobChip } from "./components/JobChip";
import { parseRoute } from "./route";
import { Home } from "./screens/Home";
import { Library } from "./screens/Library";
import { MapScreen } from "./screens/MapScreen";
import { OutlineScreen } from "./screens/OutlineScreen";
import { Settings } from "./screens/Settings";
import { StoryScreen } from "./screens/StoryScreen";

export function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const h = () => setHash(location.hash);
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const r = parseRoute(hash);
  const tab = r.name === "library" || r.name === "outline" ? "library" : r.name === "settings" ? "settings" : "learn";

  return (
    <div className="app">
      <div className="view">
        {r.name === "home" && <Home />}
        {r.name === "map" && <MapScreen key={r.sid} sid={r.sid} focus={r.focus} node={r.node} hl={r.hl} view={r.view} quote={r.quote} />}
        {r.name === "story" && <StoryScreen key={r.id} id={r.id} />}
        {r.name === "library" && <Library />}
        {r.name === "outline" && <OutlineScreen id={r.id} />}
        {r.name === "settings" && <Settings section={r.section} />}
      </div>
      <JobChip />
      <nav className="tabs" aria-label="Main">
        <a href="#/" className={tab === "learn" ? "on" : ""} aria-current={tab === "learn" ? "page" : undefined}>Learn</a>
        <a href="#/library" className={tab === "library" ? "on" : ""} aria-current={tab === "library" ? "page" : undefined}>Library</a>
        <a href="#/settings" className={tab === "settings" ? "on" : ""} aria-current={tab === "settings" ? "page" : undefined}>Settings</a>
      </nav>
    </div>
  );
}
