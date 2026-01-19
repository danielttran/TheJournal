import { createSwaggerSpec } from 'next-swagger-doc';
import { NextResponse } from 'next/server';

export async function GET() {
    const spec = createSwaggerSpec({
        apiFolder: 'src/app/api', // define api folder
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'TheJournal API Doc',
                version: '1.0',
            },
            tags: [
                {
                    name: 'Health',
                    description: 'Health check endpoints',
                }
            ],
            components: {
                securitySchemes: {
                    BearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                    },
                },
            },
            security: [],
        },
    });
    return NextResponse.json(spec);
}
