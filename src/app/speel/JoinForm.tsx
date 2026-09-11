"use client";

import { useActionState, useState } from "react";
import { joinRally } from "@/lib/play/actions";

type JoinState = { error?: string } | null;

async function action(_prev: JoinState, formData: FormData): Promise<JoinState> {
  return await joinRally(formData);
}

export default function JoinForm() {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(action, null);
  // Only the part AFTER the fixed "RLY-" prefix is typed, so players can't
  // mistype the prefix. The server re-applies "RLY-" (and tolerates a pasted
  // full code), so we submit just the suffix.
  const [suffix, setSuffix] = useState("");

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="field-label" htmlFor="joinCode">
          Teamcode
        </label>
        <div className="flex items-stretch overflow-hidden rounded-soft border-2 border-polder-line focus-within:border-teal">
          <span className="flex select-none items-center bg-paper px-3 font-bold tracking-[2px] text-polder-grey">RLY-</span>
          <input
            id="joinCode"
            name="joinCode"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
            inputMode="text"
            required
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="w-full border-0 bg-white px-2 py-2 text-center font-bold tracking-[2px] outline-none"
            placeholder="7H2K"
          />
        </div>
        <p className="mt-1 text-[11px] text-polder-grey">Alleen het deel na &ldquo;RLY-&rdquo; invullen — die staat vast.</p>
      </div>
      <div>
        <label className="field-label" htmlFor="teamName">
          Teamnaam
        </label>
        <input
          id="teamName"
          name="teamName"
          defaultValue=""
          maxLength={24}
          required
          placeholder="Bijv. De Verdwaalde Vossen"
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
