import {
    AnalyzeIDCommand,
    AnalyzeIDCommandInput,
    AnalyzeIDCommandOutput,
    Document,
    TextractClient,
} from '@aws-sdk/client-textract';
import { AppError } from '../utils/app-error';

export interface IdentityDocumentBase64Input {
    imageBase64: string;
}

export interface IdentityDocumentS3UriInput {
    s3ObjectUrl: string;
}

export interface IdentityDocumentS3ObjectInput {
    s3Object: {
        bucket: string;
        key: string;
        version?: string;
    };
}

export type IdentityDocumentInput =
    | IdentityDocumentBase64Input
    | IdentityDocumentS3UriInput
    | IdentityDocumentS3ObjectInput;

export interface ExtractedField {
    key: string;
    value: string;
    confidence: number | null;
}

export interface IdentityBio {
    fullName: string | null;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
    documentNumber: string | null;
    documentType: string | null;
    issuingCountry: string | null;
    nationality: string | null;
    dateOfBirth: string | null;
    expirationDate: string | null;
    issueDate: string | null;
    sex: string | null;
    address: string | null;
    placeOfBirth: string | null;
}

export interface ExtractIdentityBioInput {
    documents: IdentityDocumentInput[];
}

export interface ExtractIdentityBioResult {
    bio: IdentityBio;
    fields: ExtractedField[];
}

class TextractIdentityService {
    private readonly _client: TextractClient;

    constructor() {
        this._client = new TextractClient({
            region: process.env.APP_AWS_REGION || process.env.AWS_REGION || 'us-east-1',
        });
    }

    async extractBio(input: ExtractIdentityBioInput): Promise<ExtractIdentityBioResult> {
        if (!input.documents.length) {
            throw new AppError('At least one document image is required.', 400, 'DOCUMENT_REQUIRED');
        }

        const commandInput: AnalyzeIDCommandInput = {
            DocumentPages: input.documents.map((document) => this.toTextractDocument(document)),
        };

        let response: AnalyzeIDCommandOutput;

        try {
            response = await this._client.send(new AnalyzeIDCommand(commandInput));
        } catch (error) {
            throw new AppError(
                error instanceof Error ? error.message : 'Textract request failed.',
                502,
                'TEXTRACT_REQUEST_FAILED',
            );
        }

        const fields = this.flattenFields(response);

        if (!fields.length) {
            throw new AppError(
                'No identity data could be extracted from the supplied document.',
                422,
                'IDENTITY_DATA_NOT_FOUND',
            );
        }

        return {
            bio: this.buildBio(fields),
            fields,
        };
    }

    private flattenFields(response: AnalyzeIDCommandOutput): ExtractedField[] {
        const fieldMap = new Map<string, ExtractedField>();

        for (const document of response.IdentityDocuments ?? []) {
            for (const field of document.IdentityDocumentFields ?? []) {
                const key = field.Type?.Text?.trim();
                const rawValue = field.ValueDetection?.NormalizedValue?.Value ?? field.ValueDetection?.Text?.trim();

                if (!key || !rawValue) {
                    continue;
                }

                const normalizedKey = this.normalizeFieldKey(key);
                const confidence = field.ValueDetection?.Confidence ?? null;
                const existing = fieldMap.get(normalizedKey);

                if (!existing || (confidence ?? 0) > (existing.confidence ?? 0)) {
                    fieldMap.set(normalizedKey, {
                        key: normalizedKey,
                        value: rawValue,
                        confidence,
                    });
                }
            }
        }

        return Array.from(fieldMap.values()).sort((left, right) => left.key.localeCompare(right.key));
    }

    private toTextractDocument(document: IdentityDocumentInput): Document {
        if ('imageBase64' in document) {
            return {
                Bytes: this.decodeBase64(document.imageBase64),
            };
        }

        if ('s3Object' in document) {
            return {
                S3Object: {
                    Bucket: document.s3Object.bucket,
                    Name: document.s3Object.key,
                    Version: document.s3Object.version,
                },
            };
        }

        if ('s3ObjectUrl' in document) {
            const s3Object = this.parseS3Uri(document.s3ObjectUrl);
            return {
                S3Object: {
                    Bucket: s3Object.bucket,
                    Name: s3Object.key,
                },
            };
        }

        throw new AppError('Unsupported identity document source.', 400, 'INVALID_DOCUMENT_SOURCE');
    }

    private buildBio(fields: ExtractedField[]): IdentityBio {
        const valueByKey = new Map(fields.map((field) => [field.key, field.value]));

        const firstName = this.pick(valueByKey, 'FIRST_NAME', 'GIVEN_NAME');
        const middleName = this.pick(valueByKey, 'MIDDLE_NAME');
        const lastName = this.pick(valueByKey, 'LAST_NAME', 'SURNAME');
        const fullName = this.pick(valueByKey, 'FULL_NAME', 'NAME') ?? this.composeName(firstName, middleName, lastName);

        return {
            fullName,
            firstName,
            middleName,
            lastName,
            documentNumber: this.pick(valueByKey, 'DOCUMENT_NUMBER', 'ID_NUMBER'),
            documentType: this.pick(valueByKey, 'DOCUMENT_TYPE'),
            issuingCountry: this.pick(valueByKey, 'ISSUING_COUNTRY', 'COUNTRY'),
            nationality: this.pick(valueByKey, 'NATIONALITY'),
            dateOfBirth: this.pick(valueByKey, 'DATE_OF_BIRTH', 'BIRTH_DATE', 'DOB'),
            expirationDate: this.pick(valueByKey, 'EXPIRATION_DATE', 'DATE_OF_EXPIRY'),
            issueDate: this.pick(valueByKey, 'DATE_OF_ISSUE', 'ISSUE_DATE'),
            sex: this.pick(valueByKey, 'SEX', 'GENDER'),
            address: this.pick(valueByKey, 'ADDRESS'),
            placeOfBirth: this.pick(valueByKey, 'PLACE_OF_BIRTH'),
        };
    }

    private decodeBase64(value: string): Uint8Array {
        const normalized = value.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');

        if (!normalized) {
            throw new AppError('Document image cannot be empty.', 400, 'INVALID_DOCUMENT');
        }

        try {
            return Uint8Array.from(Buffer.from(normalized, 'base64'));
        } catch {
            throw new AppError('Document image must be valid base64.', 400, 'INVALID_DOCUMENT');
        }
    }

    private parseS3Uri(uri: string): { bucket: string; key: string } {
        const s3UriMatch = uri.match(/^s3:\/\/([^/]+)\/(.+)$/i);

        if (s3UriMatch) {
            const [, bucket, key] = s3UriMatch;
            return { bucket, key };
        }

        let parsedUrl: URL;

        try {
            parsedUrl = new URL(uri);
        } catch {
            throw new AppError(
                'Invalid S3 location. Expected s3://bucket/key or an HTTPS S3 object URL.',
                400,
                'INVALID_S3_URI',
            );
        }

        if (parsedUrl.protocol !== 'https:') {
            throw new AppError(
                'Invalid S3 location. Expected s3://bucket/key or an HTTPS S3 object URL.',
                400,
                'INVALID_S3_URI',
            );
        }

        const host = parsedUrl.hostname.toLowerCase();
        const path = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));

        if (host.includes('.s3.') || host.endsWith('.s3.amazonaws.com')) {
            const bucket = parsedUrl.hostname.split('.')[0];

            if (bucket && path) {
                return { bucket, key: path };
            }
        }

        if ((host.startsWith('s3.') || host === 's3.amazonaws.com') && path.includes('/')) {
            const [bucket, ...keyParts] = path.split('/');
            const key = keyParts.join('/');

            if (bucket && key) {
                return { bucket, key };
            }
        }

        throw new AppError(
            'Invalid S3 location. Expected s3://bucket/key or an HTTPS S3 object URL.',
            400,
            'INVALID_S3_URI',
        );
    }

    private normalizeFieldKey(key: string): string {
        return key
            .trim()
            .replace(/[^A-Za-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase();
    }

    private pick(map: Map<string, string>, ...keys: string[]): string | null {
        for (const key of keys) {
            const value = map.get(key);

            if (value) {
                return value;
            }
        }

        return null;
    }

    private composeName(...parts: Array<string | null>): string | null {
        const fullName = parts.filter(Boolean).join(' ').trim();
        return fullName || null;
    }
}

const textractIdentityService = new TextractIdentityService();

export async function extractIdentityBio(
    input: ExtractIdentityBioInput,
): Promise<ExtractIdentityBioResult> {
    return textractIdentityService.extractBio(input);
}
