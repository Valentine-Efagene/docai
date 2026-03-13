import express, { Request, Response } from 'express';
import { identityRouter } from './routes/identity';
import { errorHandler } from './middleware/error-handler';
import { generateOpenAPIDocument } from './config/swagger';

export const app = express();

app.use(express.json({ limit: '15mb' }));

app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', service: 'docai' });
});

// Swagger documentation - generate with dynamic base URL
app.get('/openapi.json', (_req: Request, res: Response) => {
    // Use empty string for server URL so Swagger UI uses relative paths from current origin
    const openApiDocument = generateOpenAPIDocument();
    res.json(openApiDocument);
});

// Serve Swagger UI using CDN (works better in serverless)
app.get('/api-docs', (_req: Request, res: Response) => {
    const openApiDocument = generateOpenAPIDocument();
    const specJson = JSON.stringify(openApiDocument);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>API Documentation - DocAI</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
        window.onload = () => {
            // Build the base URL from current location, removing /api-docs and hash
            const url = new URL(window.location.href);
            const basePath = url.pathname.replace(/\\/api-docs\\/?$/, '');
            const currentPath = url.origin + basePath;
            
            // Parse the spec from JSON string
            const specString = ${JSON.stringify(specJson)};
            const spec = JSON.parse(specString);
            
            if (spec.servers && spec.servers[0]) {
                spec.servers[0].url = currentPath;
            }
            
            window.ui = SwaggerUIBundle({
                spec: spec,
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [SwaggerUIBundle.presets.apis]
            });
        };
    </script>
</body>
</html>`;
    res.send(html);
});

app.use('/identity', identityRouter);

app.use(errorHandler);
