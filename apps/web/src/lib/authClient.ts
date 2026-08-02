import { createBrowserAuthClient } from "@byok/auth/client";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export const authClient = createBrowserAuthClient({ baseURL: API_URL });
export const { signIn, signUp, signOut, useSession } = authClient;
