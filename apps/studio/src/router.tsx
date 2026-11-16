/* The studio's router: path-based, as small as the studio and OUI's generator
   need. The generator reads <Route path element> from routes.tsx; at run time
   <Routes> renders the first route whose pattern matches location.pathname
   and passes its :params. navigation (AppNavigation) lets the agent navigate
   the same way links do. */
import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export function navigate(path: string) {
  if (path === window.location.pathname + window.location.search) return;
  window.history.pushState(null, "", path);
  notify();
}
if (typeof window !== "undefined") window.addEventListener("popstate", notify);

export const navigation = {
  navigate,
  location: () => window.location.pathname,
  subscribe(listener: (path: string) => void) {
    const l = () => listener(window.location.pathname);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useLocationPath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => navigation.subscribe(setPath), []);
  return path;
}

const ParamsContext = createContext<Record<string, string>>({});
export const useParams = () => useContext(ParamsContext);

function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Routes({ children }: { children: ReactNode }) {
  const path = useLocationPath();
  const routes = (Array.isArray(children) ? children : [children]) as ReactElement<{ path: string; element: ReactElement }>[];
  for (const r of routes) {
    const params = r?.props?.path ? match(r.props.path, path) : null;
    if (params) return <ParamsContext.Provider value={params}>{r.props.element}</ParamsContext.Provider>;
  }
  return null;
}

export function Route(_props: { path: string; element: ReactElement }) {
  return null;
}
