"use server";

import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";

const FormSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(6),
});

export async function login(formData: FormData) {
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
            // Create user for demo purposes if not exists (Simplified "Auth")
            console.log('User not found. Registering new user...');

            const { hash, salt, iterations } = hashPassword(validPassword);

            const stmt = db.prepare('INSERT INTO User (Username, PasswordHash, Salt, Iterations) VALUES (?, ?, ?, ?)');
            const info = stmt.run(validUsername, hash, salt, iterations);

            console.log('Created new user ID:', info.lastInsertRowid);
            redirect("/");
            return
        }

        // Verify Password
        const isValid = verifyPassword(validPassword, user.PasswordHash, user.Salt, user.Iterations);

        if (!isValid) {
            return {
                message: "Invalid credentials.",
            };
        }

        // Success
        console.log('User logged in successfully:', user.Username);
        redirect("/");

    } catch (error) {
        if ((error as any).digest?.startsWith('NEXT_REDIRECT')) {
            throw error;
        }
        console.error("Login error:", error);
        return {
            message: "Database error: " + (error as Error).message,
        };
    }
}
