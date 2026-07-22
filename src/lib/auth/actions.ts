"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/ontwerp") || "/ontwerp";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const code = error.code ?? "";
    const msg = error.message?.toLowerCase() ?? "";
    if (code === "email_not_confirmed" || msg.includes("not confirmed")) {
      return {
        error:
          "Je e-mailadres is nog niet bevestigd. Zet in Supabase (Authentication → Providers → Email) 'Confirm email' uit, of bevestig de gebruiker handmatig — zie README.",
      };
    }
    return { error: "Onjuiste inloggegevens (of onbevestigd account). Probeer opnieuw." };
  }

  revalidatePath("/ontwerp", "layout");
  redirect(next.startsWith("/ontwerp") ? next : "/ontwerp");
}

export async function signup(formData: FormData): Promise<{ error?: string; message?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Wachtwoord moet minstens 8 tekens zijn." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  // If email confirmation is disabled, a session is returned immediately.
  if (data.session) {
    revalidatePath("/ontwerp", "layout");
    redirect("/ontwerp");
  }
  return {
    message:
      "Account aangemaakt — bevestig je e-mail en log daarna in. Komt er geen mail? Zet dan 'Confirm email' uit in Supabase (Authentication → Providers → Email).",
  };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
