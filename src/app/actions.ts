"use server";

import { db, dbManager } from "@/lib/db";
import { deriveMasterKey } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";

const FormSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(1),
});

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
        const hexKey = await deriveMasterKey(validatedFields.data.password);
        
        try {
            await dbManager.unlock(hexKey);
        } catch (e) {
            return { message: "Invalid credentials (unlock failed)." };
        }

        const user = await db.prepare('SELECT * FROM User WHERE Username = ?').get(validatedFields.data.username) as any;

        if (!user) {
            return { message: "Invalid credentials." };
        }

        const { cookies } = await import("next/headers");
        (await cookies()).set("userId", user.UserID.toString(), {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 60 * 60 * 24 * 30, // 30 days
        });

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
        const hexKey = await deriveMasterKey(validatedFields.data.password);
        await dbManager.unlock(hexKey);

        const user = await db.prepare('SELECT 1 FROM User WHERE Username = ?').get(validatedFields.data.username);

        if (user) {
            return { message: "Username already taken." };
        }

        await db.prepare('INSERT INTO User (Username) VALUES (?)').run(validatedFields.data.username);

        redirect("/login?registered=true");
    } catch (error) {
        if ((error as any).digest?.startsWith('NEXT_REDIRECT')) throw error;
        return { message: "Registration error: " + (error as Error).message };
    }
}
