import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { registry, ApiErrorSchema } from '../config/swagger';
import {
    extractIdentityBio,
} from '../services/textract-identity-service';

const router = Router();

const Base64DocumentSchema = z.string().min(1).openapi({
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...',
    description: 'Base64-encoded identity document image. Data URLs are also accepted.',
});

const S3ObjectUrlSchema = z
    .string()
    .min(1)
    .refine(
        (value) => {
            if (/^s3:\/\/[^/]+\/.+$/i.test(value)) {
                return true;
            }

            try {
                const parsed = new URL(value);
                return parsed.protocol === 'https:' && parsed.hostname.includes('s3') && parsed.pathname.length > 1;
            } catch {
                return false;
            }
        },
        {
            message: 'Expected either s3://bucket/key or an HTTPS S3 object URL',
        },
    )
    .openapi({
        example: 's3://docai-uploads/identity/passport.jpg',
        description: 'S3 object location. Supported formats: s3://bucket/key, https://bucket.s3.<region>.amazonaws.com/key, or https://s3.<region>.amazonaws.com/bucket/key.',
    });

const ExtractBioFromBase64RequestSchema = z.object({
    documents: z.array(Base64DocumentSchema).min(1).max(2).openapi({
        description: 'One or two document images. Use one page for a passport or the front of an ID card, and optionally a second page for the back of an ID card.',
    }),
}).openapi('ExtractBioFromBase64Request');

const ExtractBioFromS3UrlRequestSchema = z.object({
    documents: z.array(S3ObjectUrlSchema).min(1).max(2).openapi({
        description: 'One or two S3 object locations. Use one page for a passport or the front of an ID card, and optionally a second page for the back of an ID card.',
    }),
}).openapi('ExtractBioFromS3UrlRequest');

const ExtractedFieldSchema = z.object({
    key: z.string(),
    value: z.string(),
    confidence: z.number().nullable(),
}).openapi('ExtractedField');

const BioSchema = z.object({
    fullName: z.string().nullable(),
    firstName: z.string().nullable(),
    middleName: z.string().nullable(),
    lastName: z.string().nullable(),
    documentNumber: z.string().nullable(),
    documentType: z.string().nullable(),
    issuingCountry: z.string().nullable(),
    nationality: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    expirationDate: z.string().nullable(),
    issueDate: z.string().nullable(),
    sex: z.string().nullable(),
    address: z.string().nullable(),
    placeOfBirth: z.string().nullable(),
}).openapi('IdentityBio');

const ExtractBioResponseSchema = z.object({
    success: z.literal(true),
    bio: BioSchema,
    fields: z.array(ExtractedFieldSchema),
}).openapi('ExtractBioResponse');

registry.registerPath({
    method: 'post',
    path: '/identity/bio/base64',
    tags: ['Identity'],
    summary: 'Extract a person bio from base64 document images',
    description: 'Uses AWS Textract AnalyzeID to extract biographic data from base64-encoded identity document images.',
    request: {
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: ExtractBioFromBase64RequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Identity bio extracted successfully',
            content: {
                'application/json': {
                    schema: ExtractBioResponseSchema,
                },
            },
        },
        400: {
            description: 'Invalid request body',
            content: {
                'application/json': {
                    schema: ApiErrorSchema,
                },
            },
        },
        502: {
            description: 'Textract could not process the document',
            content: {
                'application/json': {
                    schema: ApiErrorSchema,
                },
            },
        },
    },
});

registry.registerPath({
    method: 'post',
    path: '/identity/bio/s3-url',
    tags: ['Identity'],
    summary: 'Extract a person bio from S3 object URLs',
    description: 'Uses AWS Textract AnalyzeID to extract biographic data from S3 object URLs.',
    request: {
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: ExtractBioFromS3UrlRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Identity bio extracted successfully',
            content: {
                'application/json': {
                    schema: ExtractBioResponseSchema,
                },
            },
        },
        400: {
            description: 'Invalid request body',
            content: {
                'application/json': {
                    schema: ApiErrorSchema,
                },
            },
        },
        502: {
            description: 'Textract could not process the document',
            content: {
                'application/json': {
                    schema: ApiErrorSchema,
                },
            },
        },
    },
});

/**
 * POST /identity/bio
 *
 * Accepts one or two identity document images from either /base64 or /s3-url and extracts a person's
 * biographic details using AWS Textract AnalyzeID.
 */
router.get(
    '/',
    (_req: Request, res: Response) => {
        res.json({
            message: 'Use POST /identity/bio/base64 or POST /identity/bio/s3-url to extract biographic data from an ID card or passport.',
        });
    }
);

router.post(
    '/bio/base64',
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const payload = ExtractBioFromBase64RequestSchema.parse(req.body);
            const result = await extractIdentityBio({
                documents: payload.documents.map((imageBase64) => ({ imageBase64 })),
            });

            res.json({
                success: true,
                bio: result.bio,
                fields: result.fields,
            });
        } catch (error) {
            next(error);
        }
    }
);

router.post(
    '/bio/s3-url',
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const payload = ExtractBioFromS3UrlRequestSchema.parse(req.body);
            const result = await extractIdentityBio({
                documents: payload.documents.map((s3ObjectUrl) => ({ s3ObjectUrl })),
            });

            res.json({
                success: true,
                bio: result.bio,
                fields: result.fields,
            });
        } catch (error) {
            next(error);
        }
    }
);

export const identityRouter = router;
