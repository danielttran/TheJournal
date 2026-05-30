"use server";

import { db, dbManager } from "@/lib/db";
import { getAppDbKey, hashPassword, verifyPassword } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { seedDefaultCategories } from "@/lib/defaultCategories";
import { redirect } from "next/navigation";
import { z } from "zod";

const FormSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(1),
});

async function setSession(userId: number) {
    const { cookies } = await import("next/headers");
    // HMAC-signed token, not a bare id — the cookie can be read by the server
    // but not forged by the client.
    (await cookies()).set(SESSION_COOKIE, createSessionToken(userId), {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_MAX_AGE_SECONDS,
    });
}

export async function login(prevState: unknown, formData: FormData) {
    const username = formData.get("username");
    const password = formData.get("password") as string;

    const validatedFields = FormSchema.safeParse({ username, password });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing Fields. Failed to Login.",
        };
    }

    try {
        // Unlock DB with fixed app key (never changes, never locks)
        await dbManager.unlock(getAppDbKey());

        const user = await db.prepare('SELECT * FROM User WHERE Username = ?').get(validatedFields.data.username) as { UserID: number; PasswordHash: string | null } | undefined;

        if (!user) {
            return { message: "Invalid credentials." };
        }

        if (user.PasswordHash) {
            const ok = await verifyPassword(user.PasswordHash, validatedFields.data.password);
            if (!ok) {
                return { message: "Invalid credentials." };
            }
        } else {
            // Legacy account migration: a pre-migration row with no PasswordHash
            // is claimed by the first login by hashing and storing the supplied
            // password. Without this, NULL hash would silently accept any
            // password (an auth-bypass vector). After this branch runs, the
            // account requires the same password on subsequent logins.
            const newHash = await hashPassword(validatedFields.data.password);
            await db.prepare('UPDATE User SET PasswordHash = ? WHERE UserID = ? AND PasswordHash IS NULL')
                .run(newHash, user.UserID);
            console.warn(`[Action:Login] Migrated legacy account (UserID=${user.UserID}) to hashed password`);
        }

        await setSession(user.UserID);
        redirect("/dashboard");
    } catch (error) {
        if ((error as { digest?: string }).digest?.startsWith?.('NEXT_REDIRECT')) throw error;
        console.error('[Action:Login] error:', error);
        return { message: "Login failed. Please try again." };
    }
}

export async function logout() {
    // Don't close the DB — just clear the session cookie
    const { cookies } = await import("next/headers");
    (await cookies()).delete(SESSION_COOKIE);
    redirect("/login");
}

const RegisterSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(1),
    confirmPassword: z.string().min(1),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

export async function register(prevState: unknown, formData: FormData) {
    const username = formData.get("username");
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword");

    const validatedFields = RegisterSchema.safeParse({ username, password, confirmPassword });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing Fields. Failed to Register.",
        };
    }

    try {
        // Unlock DB with fixed app key
        await dbManager.unlock(getAppDbKey());

        // Hash before existence check so timing is constant whether or not the
        // username is taken. Rely on the UNIQUE index (or duplicate check inside
        // the INSERT) to surface conflicts.
        const passwordHash = await hashPassword(validatedFields.data.password);

        const existingUser = await db.prepare('SELECT 1 FROM User WHERE Username = ?').get(validatedFields.data.username);
        if (existingUser) {
            // Generic message — do not confirm or deny username existence.
            return { message: "Registration failed. Please try a different username." };
        }

        const result = await db.prepare('INSERT INTO User (Username, PasswordHash) VALUES (?, ?)').run(validatedFields.data.username, passwordHash);

        // DavidRM parity: seed a fresh account with a Daily Journal +
        // Notebook so the user lands on a usable layout. Idempotent — if
        // the seed fails for some reason we still let registration succeed
        // (the user can create categories manually).
        try {
            await seedDefaultCategories(dbManager, Number(result.lastInsertRowid));
        } catch (err) {
            console.error('[Action:Register] seedDefaultCategories failed:', err);
        }

        await setSession(result.lastInsertRowid);
        redirect("/dashboard");
    } catch (error) {
        if ((error as { digest?: string }).digest?.startsWith?.('NEXT_REDIRECT')) throw error;
        console.error('[Action:Register] error:', error);
        return { message: "Registration failed. Please try again." };
    }
}
