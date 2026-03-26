"use server";

import { db, dbManager } from "@/lib/db";
import { deriveMasterKey } from "@/lib/auth";
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
            message: "Missing Fields. Failed to Login." 
        };
    }

    try {
        console.log(`[Action:Login] Attempting login for: ${validatedFields.data.username}`);
        const hexKey = await deriveMasterKey(validatedFields.data.password);
        
        try {
            // Use force=true to ensure we replace any stale/wrongly-keyed instance
            await dbManager.unlock(hexKey, true);
        } catch (e) {
            console.error("[Action:Login] Unlock failed:", e);
            return { message: "Invalid credentials (unlock failed)." };
        }

        const user = await db.prepare('SELECT * FROM User WHERE Username = ?').get(validatedFields.data.username) as any;

        if (!user) {
            console.warn("[Action:Login] User not found");
            return { message: "Invalid credentials." };
        }

        await setSession(user.UserID);
        console.log("[Action:Login] Success, redirecting to dashboard");
        redirect("/dashboard");
    } catch (error) {
        if ((error as any).digest?.startsWith('NEXT_REDIRECT')) throw error;
        return { message: "Database error: " + (error as Error).message };
    }
}

export async function logout() {
    dbManager.close(); // Disconnect and wipe key from RAM
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
            message: "Missing Fields. Failed to Register." 
        };
    }

    try {
        console.log(`[Action:Register] Attempting registration for: ${validatedFields.data.username}`);
        const hexKey = await deriveMasterKey(validatedFields.data.password);
        
        // Unlock (creates DB if needed)
        await dbManager.unlock(hexKey, true);

        const existingUser = await db.prepare('SELECT 1 FROM User WHERE Username = ?').get(validatedFields.data.username);

        if (existingUser) {
            return { message: "Username already taken." };
        }

        const result = await db.prepare('INSERT INTO User (Username) VALUES (?)').run(validatedFields.data.username);
        
        // Auto-login after successful registration
        await setSession(result.lastInsertRowid);
        console.log("[Action:Register] Success, auto-logged in, redirecting to dashboard");
        redirect("/dashboard");
    } catch (error) {
        if ((error as any).digest?.startsWith('NEXT_REDIRECT')) throw error;
        return { message: "Registration error: " + (error as Error).message };
    }
}
