"use client";

import { useActionState } from "react";
import { joinRally } from "@/lib/play/actions";

type JoinState = { error?: string } | null;

async function action(_prev: JoinState, formData: FormData): Promise<JoinState> {
  return await joinRally(formData);
}

export default function JoinForm() {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="field-label" htmlFor="joinCode">
          Teamcode
        </label>
        <input
          id="joinCode"
          name="joinCode"
          defaultValue="RLY-7H2K"
          autoCapitalize="characters"
          className="input text-center font-bold tracking-[2px]"
          placeholder="RLY-XXXX"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="teamName">
          Teamnaam
        </label>
        <input
          id="teamName"
          name="teamName"
          defaultValue="De Verdwaalde Vossen"
          maxLength={24}
          className="input"
        />
      </div>
      {state?.error ? <div className="feedback-err">❌ {state.error}</div> : null}
      <button type="submit" disabled={pending} className="btn btn-primary w-full disabled:opacity-60">
        {pending ? "Bezig…" : "🚩 Start de rally"}
      </button>
    </form>
  );
}
