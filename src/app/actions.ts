"use server";

import { db, dbManager } from "@/lib/db";
import { getAppDbKey, hashPassword, verifyPassword } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";

const FormSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(1),
});

async function setSession(userId: number) {
    const { cookies } = await import("next/headers");
    (await cookies()).set("userId", userId.toString(), {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 30, // 30 days
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
        console.log(`[Action:Login] Attempting login for: ${validatedFields.data.username}`);

        // Unlock DB with fixed app key (never changes, never locks)
        await dbManager.unlock(getAppDbKey());

        const user = await db.prepare('SELECT * FROM User WHERE Username = ?').get(validatedFields.data.username) as any;

        if (!user) {
            console.warn("[Action:Login] User not found");
            return { message: "Invalid credentials." };
        }

        // Verify password against stored hash
        if (user.PasswordHash) {
            const ok = await verifyPassword(user.PasswordHash, validatedFields.data.password);
            if (!ok) {
                console.warn("[Action:Login] Bad password");
                return { message: "Invalid credentials." };
            }
        }
        // (If no PasswordHash stored yet — legacy account — allow login so user isn't locked out)

        await setSession(user.UserID);
        console.log("[Action:Login] Success, redirecting to dashboard");
        redirect("/dashboard");
    } catch (error) {
        if ((error as any).digest?.startsWith('NEXT_REDIRECT')) throw error;
        return { message: "Database error: " + (error as Error).message };
    }
}

export async function logout() {
    // Don't close the DB — just clear the session cookie
    const { cookies } = await import("next/headers");
    (await cookies()).delete("userId");
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
        console.log(`[Action:Register] Attempting registration for: ${validatedFields.data.username}`);

        // Unlock DB with fixed app key
        await dbManager.unlock(getAppDbKey());

        const existingUser = await db.prepare('SELECT 1 FROM User WHERE Username = ?').get(validatedFields.data.username);
        if (existingUser) {
            return { message: "Username already taken." };
        }

        // Hash the password and store it
        const passwordHash = await hashPassword(validatedFields.data.password);
        const result = await db.prepare('INSERT INTO User (Username, PasswordHash) VALUES (?, ?)').run(validatedFields.data.username, passwordHash);

        await setSession(result.lastInsertRowid);
        console.log("[Action:Register] Success, auto-logged in, redirecting to dashboard");
        redirect("/dashboard");
    } catch (error) {
        if ((error as any).digest?.startsWith('NEXT_REDIRECT')) throw error;
        return { message: "Registration error: " + (error as Error).message };
    }
}
