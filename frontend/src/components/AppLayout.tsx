import { useEffect, useState } from "react";
import { AlertTriangle, AudioLines, Lock, Moon, Plus, Settings, Sun } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { api } from "@/api";
import type { Health } from "@/types";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    isActive ? "text-foreground" : "text-muted-foreground",
  );

export function AppLayout() {
  const [health, setHealth] = useState<Health | null>(null);
  const { dark, toggle } = useTheme();

  useEffect(() => {
    api.health().then(setHealth, () => undefined);
  }, []);

  const lock = async () => {
    await api.logout().catch(() => undefined);
    window.location.reload();
  };

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2">
        Skip to content
      </a>
      {health?.cloud_mode && (
        <div role="alert" className="flex items-center justify-center gap-2 bg-yellow-300 px-4 py-2 text-center text-sm font-medium text-yellow-950 print:hidden">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Cloud mode: audio/text is sent to a third-party service.
          <span className="hidden font-normal sm:inline">
            ({[health.transcribe_engine === "groq" && "transcription", health.llm_engine === "groq" && "AI insights"].filter(Boolean).join(" and ")} via Groq)
          </span>
        </div>
      )}
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur print:hidden">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 rounded-lg text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <AudioLines className="h-5 w-5 text-sage" aria-hidden />
            Verbatim
          </Link>
          <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Main">
            <NavLink to="/" end className={navClass}>Sessions</NavLink>
            <NavLink to="/settings" className={navClass} aria-label="Settings">
              <Settings className="h-4 w-4 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">Settings</span>
            </NavLink>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" size="icon" onClick={lock} aria-label="Lock the app" title="Lock">
              <Lock />
            </Button>
            <Button asChild size="sm" className="ml-1">
              <Link to="/new">
                <Plus /> <span className="hidden sm:inline">New session</span>
              </Link>
            </Button>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <Outlet context={health} />
      </main>
      <Toaster />
    </div>
  );
}
