//app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, confirmSignIn, signOut } from "aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";

export default function LoginPage() {
  const router = useRouter();
    const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function signInReplacingExistingSession(username: string, password: string) {
    try {
      return await signIn({ username, password });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "");

      if (
        msg.includes("already a signed in user") ||
        msg.includes("already signed in user")
      ) {
        await signOut();
        return await signIn({ username, password });
      }

      throw e;
    }
  }
    async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    try {
      ensureAmplifyConfigured();

      if (needsNewPassword) {
        const result = await confirmSignIn({
          challengeResponse: newPw,
        });

        if (result?.isSignedIn) {
          router.replace("/mi/overview");
        } else {
          setErr(`Next step required: ${result?.nextStep?.signInStep ?? "unknown"}`);
        }

        return;
      }

            const result = await signInReplacingExistingSession(email, pw);

      if (result?.isSignedIn) {
        router.replace("/mi/overview");
        return;
      }

      if (result?.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        setNeedsNewPassword(true);
        setErr("A new password is required before you can sign in.");
        return;
      }

      setErr(`Next step required: ${result?.nextStep?.signInStep ?? "unknown"}`);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-[420px] p-4">
      <h1 className="text-2xl font-semibold mb-4">Sign in</h1>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="text-sm text-neutral-300">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2"
            autoComplete="email"
          />
        </div>

                <div className="space-y-1">
          <label className="text-sm text-neutral-300">Password</label>
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            type="password"
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2"
            autoComplete="current-password"
            disabled={busy || needsNewPassword}
          />
        </div>
        {needsNewPassword ? (
          <div className="space-y-1">
            <label className="text-sm text-neutral-300">New password</label>
            <input
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              type="password"
              className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2"
              autoComplete="new-password"
            />
          </div>
        ) : null}
        <button
          className="w-full rounded-md bg-neutral-100 text-neutral-950 px-3 py-2 font-medium disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
                    {busy ? "Working…" : needsNewPassword ? "Set new password" : "Sign in"}
        </button>

        {err ? <p className="text-sm text-red-300">Error: {err}</p> : null}
      </form>
    </div>
  );
}