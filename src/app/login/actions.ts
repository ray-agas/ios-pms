"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";

export interface LoginState {
  error?: string;
}

export async function loginWithFallback(_previous: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("password", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirectTo: "/",
    });
    return {};
  } catch (error) {
    // Same message for wrong username, wrong password and rate limit, so nothing is revealed.
    if (error instanceof AuthError) return { error: "Sign-in failed. Check your details or try again later." };
    throw error; // includes the redirect that Next.js uses on success
  }
}

export async function loginWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}
