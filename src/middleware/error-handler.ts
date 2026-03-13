import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/app-error';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
    if (err instanceof ZodError) {
        return res.status(400).json({
            success: false,
            error: {
                message: 'Validation Error',
                code: 'VALIDATION_ERROR',
                details: err.issues,
            },
        });
    }

    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            error: {
                message: err.message,
                code: err.code,
            },
        });
    }

    console.error('Unhandled error:', err);

    return res.status(500).json({
        success: false,
        error: {
            message: 'Internal Server Error',
            code: 'INTERNAL_SERVER_ERROR',
        },
    });
}
