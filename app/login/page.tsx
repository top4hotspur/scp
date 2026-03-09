//app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  signIn,
  confirmSignIn,
  signOut,
  signUp,
  confirmSignUp,
  resendSignUpCode,
} from "aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";

const ALLOWED_REGISTRATION_EMAIL = "stevenglass@hotmail.com";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "register">("signin");

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [newPw, setNewPw] = useState("");

  // sign-in challenge
  const [needsNewPassword, setNeedsNewPassword] = useState(false);

  // sign-up challenge
  const [needsConfirmCode, setNeedsConfirmCode] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function norm(v: string) {
    return String(v ?? "").trim().toLowerCase();
  }

  async function signInReplacingExistingSession(username: string, password: string) {
    try {
      return await signIn({ username, password });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "");

      if (msg.includes("already a signed in user") || msg.includes("already signed in user")) {
        await signOut();
        return await signIn({ username, password });
      }

      throw e;
    }
  }

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOkMsg(null);
    setBusy(true);

    try {
      ensureAmplifyConfigured();

      if (needsNewPassword) {
        const result = await confirmSignIn({ challengeResponse: newPw });
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

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOkMsg(null);
    setBusy(true);

    try {
      ensureAmplifyConfigured();

      const nEmail = norm(email);
      if (nEmail !== norm(ALLOWED_REGISTRATION_EMAIL)) {
        throw new Error(`Registration is currently restricted to ${ALLOWED_REGISTRATION_EMAIL}.`);
      }

      if (needsConfirmCode) {
        const out = await confirmSignUp({ username: nEmail, confirmationCode: confirmCode.trim() });
        if (out?.isSignUpComplete) {
          setOkMsg("Registration confirmed. You can now sign in.");
          setMode("signin");
          setNeedsConfirmCode(false);
          setConfirmCode("");
        } else {
          setOkMsg("Confirmation accepted. Please sign in.");
        }
        return;
      }

      const out = await signUp({
        username: nEmail,
        password: pw,
        options: { userAttributes: { email: nEmail } },
      });

      if (out?.isSignUpComplete) {
        setOkMsg("Registration complete. You can now sign in.");
        setMode("signin");
      } else {
        setNeedsConfirmCode(true);
        setOkMsg(`Verification code sent to ${nEmail}. Enter it below to finish registration.`);
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onResendCode() {
    setErr(null);
    setOkMsg(null);
    setBusy(true);
    try {
      ensureAmplifyConfigured();
      await resendSignUpCode({ username: norm(email) });
      setOkMsg("Verification code resent.");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-[420px] p-4">
      <div className="mb-4 flex items-center gap-2">
        <button
          className={`rounded-md px-3 py-1.5 text-sm ${mode === "signin" ? "bg-neutral-100 text-neutral-950" : "bg-neutral-900 text-neutral-200"}`}
          onClick={() => {
            setMode("signin");
            setErr(null);
            setOkMsg(null);
          }}
          type="button"
        >
          Sign in
        </button>
        <button
          className={`rounded-md px-3 py-1.5 text-sm ${mode === "register" ? "bg-neutral-100 text-neutral-950" : "bg-neutral-900 text-neutral-200"}`}
          onClick={() => {
            setMode("register");
            setErr(null);
            setOkMsg(null);
            setNeedsNewPassword(false);
          }}
          type="button"
        >
          Register
        </button>
      </div>

      <h1 className="text-2xl font-semibold mb-4">{mode === "signin" ? "Sign in" : "Register"}</h1>

      {mode === "register" ? (
        <p className="mb-3 text-sm text-neutral-400">Registration is currently restricted to {ALLOWED_REGISTRATION_EMAIL}.</p>
      ) : null}

      <form onSubmit={mode === "signin" ? onSignIn : onRegister} className="space-y-3">
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
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            disabled={busy || needsNewPassword || (mode === "register" && needsConfirmCode)}
          />
        </div>

        {mode === "signin" && needsNewPassword ? (
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

        {mode === "register" && needsConfirmCode ? (
          <div className="space-y-1">
            <label className="text-sm text-neutral-300">Verification code</label>
            <input
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2"
              autoComplete="one-time-code"
            />
            <button
              type="button"
              onClick={onResendCode}
              className="text-xs text-neutral-300 underline underline-offset-2"
              disabled={busy}
            >
              Resend code
            </button>
          </div>
        ) : null}

        <button className="w-full rounded-md bg-neutral-100 text-neutral-950 px-3 py-2 font-medium disabled:opacity-50" disabled={busy} type="submit">
          {busy
            ? "Working…"
            : mode === "signin"
              ? needsNewPassword
                ? "Set new password"
                : "Sign in"
              : needsConfirmCode
                ? "Confirm registration"
                : "Create account"}
        </button>

        {okMsg ? <p className="text-sm text-emerald-300">{okMsg}</p> : null}
        {err ? <p className="text-sm text-red-300">Error: {err}</p> : null}
      </form>
    </div>
  );
}
