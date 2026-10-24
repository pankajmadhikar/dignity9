import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApi } from './openapi';

const router = Router();

router.get('/openapi.json', (_req, res) => {
  res.json(openApi);
});

router.use('/docs', swaggerUi.serve, swaggerUi.setup(openApi));

export default router;
