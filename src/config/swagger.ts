import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { OpenAPIObject } from 'openapi3-ts/oas30';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// Create a registry for all API endpoints
export const registry = new OpenAPIRegistry();

// =============================================================================
// Common Schemas
// =============================================================================

export const ApiErrorSchema = z.object({
    success: z.literal(false),
    error: z.object({
        message: z.string(),
        code: z.string().optional(),
        details: z.unknown().optional(),
    }),
}).openapi('ApiError');

registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    summary: 'Service health check',
    responses: {
        200: {
            description: 'Healthy service response',
            content: {
                'application/json': {
                    schema: z.object({
                        status: z.literal('healthy'),
                        service: z.literal('docai'),
                    }),
                },
            },
        },
    },
});

// Generate OpenAPI document
export function generateOpenAPIDocument(): OpenAPIObject {
    const generator = new OpenApiGeneratorV3(registry.definitions);

    return generator.generateDocument({
        openapi: '3.0.0',
        info: {
            version: '2.0.0',
            title: 'QShelter DocAI API',
            description: 'Document AI service that extracts biographic information from ID cards and passports using AWS Textract',
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Local development server',
            },
            {
                url: 'https://docai-dev.qshelter.com',
                description: 'Development server',
            },
            {
                url: 'https://docai.qshelter.com',
                description: 'Production server',
            },
        ],
        tags: [
            { name: 'Identity', description: 'Identity document extraction endpoints' },
            { name: 'Health', description: 'Health check endpoints' },
        ],
    });
}
