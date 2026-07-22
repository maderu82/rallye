"use client";

import { useActionState, useState } from "react";
import { login, signup } from "@/lib/auth/actions";

type State = { error?: string; message?: string } | null;

export default function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");

  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (mode === "login" ? await login(formData) : await signup(formData)),
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next ?? "/ontwerp"} />
      <div>
        <label className="field-label" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" required className="input" placeholder="jij@organisatie.nl" />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Wachtwoord</label>
        <input id="password" name="password" type="password" required className="input" placeholder="••••••••" />
      </div>
      {state?.error ? <div className="feedback-err">❌ {state.error}</div> : null}
      {state?.message ? <div className="feedback-ok">✅ {state.message}</div> : null}
      <button type="submit" disabled={pending} className="btn btn-primary w-full disabled:opacity-60">
        {pending ? "Bezig…" : mode === "login" ? "Inloggen" : "Account aanmaken"}
      </button>
      <button
        type="button"
        className="btn btn-ghost w-full"
        onClick={() => setMode((m) => (m === "login" ? "signup" : "login"))}
      >
        {mode === "login" ? "Nog geen account? Registreer" : "Al een account? Inloggen"}
      </button>
    </form>
  );
}
