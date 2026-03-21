"use server";

import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";

const FormSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(1),
});

export async function login(prevState: unknown, formData: FormData) {
    const username = formData.get("username");
    const password = formData.get("password");

    const validatedFields = FormSchema.safeParse({
        username,
        password,
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing Fields. Failed to Login.",
        };
    }

    const { username: validUsername, password: validPassword } = validatedFields.data;

    try {
        const user = db.prepare('SELECT * FROM User WHERE Username = ?').get(validUsername) as any;

        if (!user) {
            return {
                message: "Invalid credentials.",
            };
        }

        // Verify Password
        const isValid = verifyPassword(validPassword, user.PasswordHash, user.Salt, user.Iterations);

        if (!isValid) {
            return {
                message: "Invalid credentials.",
            };
        }

        // Success
        // Success logic here (silent)

        // Set cookie
        // Note: In a real app, use a secure session ID or JWT properly signed.
        // This is a simple implementation for demonstration.
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
        if ((error as any).digest?.startsWith('NEXT_REDIRECT')) {
            throw error;
        }
        /* silence */
        return {
            message: "Database error: " + (error as Error).message,
        };
    }
}

export async function logout() {
    const { cookies } = await import("next/headers");
    (await cookies()).delete("userId");
    redirect("/login");
}



const RegisterSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(1), // Removing restriction
    confirmPassword: z.string().min(1), // Removing restriction
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

export async function register(prevState: unknown, formData: FormData) {
    const username = formData.get("username");
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");

    const validatedFields = RegisterSchema.safeParse({
        username,
        password,
        confirmPassword,
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing Fields. Failed to Register.",
        };
    }

    const { username: validUsername, password: validPassword } = validatedFields.data;

    try {
        const user = db.prepare('SELECT 1 FROM User WHERE Username = ?').get(validUsername);

        if (user) {
            return {
                message: "Username already taken.",
            };
        }

        const { hash, salt, iterations } = hashPassword(validPassword);

        const stmt = db.prepare('INSERT INTO User (Username, PasswordHash, Salt, Iterations) VALUES (?, ?, ?, ?)');
        const info = stmt.run(validUsername, hash, salt, iterations);

        // Success logic here (silent)

        // NO auto-login (no cookie set)

        redirect("/login?registered=true");
    } catch (error) {
        if ((error as any).digest?.startsWith('NEXT_REDIRECT')) {
            throw error;
        }
        /* silence */
        return {
            message: "Database error: " + (error as Error).message,
        };
    }
}
