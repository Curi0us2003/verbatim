import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AudioLines, Lock } from "lucide-react";
import { api, UNAUTHORIZED_EVENT } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";

type State = "loading" | "setup" | "login" | "open" | "offline";

/** App lock (Privacy section): shows password setup or sign-in before anything else. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("loading");

  const check = () =>
    api.authStatus().then(
      (s) => setState(!s.has_password ? "setup" : s.logged_in ? "open" : "login"),
      () => setState("offline"),
    );

  useEffect(() => {
    void check();
    const onExpired = () => setState("login");
    window.addEventListener(UNAUTHORIZED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onExpired);
  }, []);

  if (state === "open") return <>{children}</>;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <p className="flex items-center justify-center gap-2 text-xl font-semibold">
          <AudioLines className="h-6 w-6 text-sage" aria-hidden /> Verbatim
        </p>
        {state === "loading" && <Skeleton className="h-56 w-full rounded-xl" />}
        {state === "offline" && (
          <Card className="p-6 text-sm">
            <p className="font-medium">Can't reach the Verbatim backend.</p>
            <p className="mt-1 text-muted-foreground">
              Start both servers with <code className="rounded bg-muted px-1">npm run dev</code> in the project folder, then{" "}
              <button className="text-primary underline" onClick={() => void check()}>try again</button>.
            </p>
          </Card>
        )}
        {(state === "setup" || state === "login") && <PasswordForm setup={state === "setup"} onDone={() => setState("open")} />}
      </div>
      <Toaster />
    </div>
  );
}

function PasswordForm({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await (setup ? api.setupPassword(password) : api.login(password));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-sage" aria-hidden /> {setup ? "Create your password" : "Welcome back"}
        </CardTitle>
        <CardDescription>
          {setup
            ? "This password locks the app so only you can open session recordings on this computer. Use at least 8 characters."
            : "Enter your password to open your sessions."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete={setup ? "new-password" : "current-password"} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {setup && (
            <div className="space-y-2">
              <Label htmlFor="confirm">Type it again</Label>
              <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-risk">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || password.length < (setup ? 8 : 1)}>
            {setup ? "Set password and continue" : "Unlock"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
