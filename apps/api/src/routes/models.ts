import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../config.js';
import { requireUserOrAdmin, requireAdmin, isUserAccountOwnerOrAdmin } from '../lib/auth.js';

export const modelsRouter = Router();

// Helper to get local models
function getLocalModels(): any[] {
  const modelsJsonPath = path.join(config.localStorageDir, 'models.json');
  if (fs.existsSync(modelsJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf-8'));
      if (Array.isArray(data)) {
        return data.map((m: any) => ({
          ...m,
          accounts: m.accounts || (m.account_handle ? { handle: m.account_handle } : null),
        }));
      }
    } catch {}
  }
  return [];
}

// Helper to save local models
function saveLocalModel(modelData: any) {
  const modelsJsonPath = path.join(config.localStorageDir, 'models.json');
  let models: any[] = [];
  if (fs.existsSync(modelsJsonPath)) {
    try {
      models = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf-8'));
      if (!Array.isArray(models)) models = [];
    } catch {
      models = [];
    }
  }

  // Remove existing with same id or version
  models = models.filter((m) => m.id !== modelData.id && m.version !== modelData.version);
  models.unshift(modelData);
  fs.writeFileSync(modelsJsonPath, JSON.stringify(models, null, 2));
}

// Helper to remove local model
function removeLocalModel(idOrVersion: string) {
  const modelsJsonPath = path.join(config.localStorageDir, 'models.json');
  if (fs.existsSync(modelsJsonPath)) {
    try {
      let models = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf-8'));
      if (Array.isArray(models)) {
        const found = models.find((m) => m.id === idOrVersion || m.version === idOrVersion);
        if (found?.artifact_path) {
          const artifactFile = path.join(config.localStorageDir, 'model-artifacts', found.artifact_path);
          if (fs.existsSync(artifactFile)) {
            fs.unlinkSync(artifactFile);
          }
        }
        models = models.filter((m) => m.id !== idOrVersion && m.version !== idOrVersion);
        fs.writeFileSync(modelsJsonPath, JSON.stringify(models, null, 2));
        return found;
      }
    } catch {}
  }
  return null;
}

// GET /api/models - List all trained models
modelsRouter.get('/', async (req: Request, res: Response) => {
  return res.json({ models: getLocalModels() });
});

// POST /api/models/train-global - Trigger training of global model
modelsRouter.post('/train-global', requireAdmin, async (req: Request, res: Response) => {
  try {
    const mlResponse = await fetch(`${config.mlServiceUrl}/train/global`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await mlResponse.json();
    if (!mlResponse.ok) {
      return res.status(mlResponse.status).json({
        error: data.detail || data.error || 'Failed to train global model',
      });
    }

    if (data.model) {
      saveLocalModel({
        id: data.model.id || `model-${data.version}`,
        model_type: 'global',
        version: data.version,
        algorithm: data.algorithm,
        artifact_path: `global/${data.version}/model.joblib`,
        metrics: data.metrics || {},
        feature_importances: data.model.feature_importances || {},
        training_rows_count: data.rows_used || 0,
        trained_at: new Date().toISOString(),
        account_handle: null,
        accounts: null,
      });
    }

    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({
      error: `Could not reach ML service at ${config.mlServiceUrl}: ${err.message}`,
    });
  }
});

// POST /api/models/train-personal/:handle - Trigger training of personal model (Requires account ownership or admin)
modelsRouter.post('/train-personal/:handle', requireUserOrAdmin, async (req: Request, res: Response) => {
  const { handle } = req.params;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');

  if (!isUserAccountOwnerOrAdmin(req, cleanHandle)) {
    return res.status(403).json({
      error: `Forbidden: You do not have permission to train personal model for @${cleanHandle}`,
      status: 403,
    });
  }

  try {
    const mlResponse = await fetch(
      `${config.mlServiceUrl}/train/personal/${encodeURIComponent(cleanHandle)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const data = await mlResponse.json();
    if (!mlResponse.ok) {
      return res.status(mlResponse.status).json({
        error: data.detail || data.error || `Failed to train personal model for @${cleanHandle}`,
      });
    }

    if (data.model) {
      saveLocalModel({
        id: data.model.id || `model-${data.version}`,
        model_type: 'personal',
        version: data.version,
        algorithm: 'stacked_ridge',
        artifact_path: `personal/${cleanHandle}/${data.version}/model.joblib`,
        metrics: data.metrics || {},
        feature_importances: { global_prediction_weight: data.blend_weight },
        training_rows_count: data.rows_used || 0,
        trained_at: new Date().toISOString(),
        account_handle: cleanHandle,
        accounts: { handle: cleanHandle },
      });
    }

    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({
      error: `Could not reach ML service at ${config.mlServiceUrl}: ${err.message}`,
    });
  }
});

const predictSchema = z.object({
  handle: z.string().min(1),
  caption: z.string().default(''),
  mediaType: z.enum(['image', 'video', 'reel', 'carousel']).default('image'),
  plannedTime: z.string().optional().nullable(),
});

// POST /api/models/predict - Predict engagement rate
modelsRouter.post('/predict', requireUserOrAdmin, async (req: Request, res: Response) => {
  const parseResult = predictSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid prediction parameters',
      details: parseResult.error.errors,
    });
  }

  const { handle, caption, mediaType, plannedTime } = parseResult.data;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');

  try {
    const mlResponse = await fetch(`${config.mlServiceUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: cleanHandle,
        caption,
        media_type: mediaType,
        planned_time: plannedTime || null,
      }),
    });

    const data = await mlResponse.json();
    if (!mlResponse.ok) {
      return res.status(mlResponse.status).json({
        error: data.detail || data.error || 'Failed to predict engagement rate',
      });
    }

    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({
      error: `Could not reach ML service at ${config.mlServiceUrl}: ${err.message}`,
    });
  }
});

// DELETE /api/models/:id - Delete a model record and its stored artifact
modelsRouter.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;

  // Delete from local models registry and disk
  const removedLocal = removeLocalModel(id);

  return res.json({
    success: true,
    message: `Model ${removedLocal?.version || id} deleted successfully.`,
  });
});

// GET /api/models/eval/runs - List all evaluation runs
modelsRouter.get('/eval/runs', async (req: Request, res: Response) => {
  try {
    const mlResponse = await fetch(`${config.mlServiceUrl}/eval/runs`);
    if (!mlResponse.ok) {
      return res.status(mlResponse.status).json({ error: 'Failed to fetch eval runs from ML service' });
    }
    const data = await mlResponse.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({ error: `Could not reach ML service: ${err.message}` });
  }
});

// GET /api/models/eval/latest - Get latest evaluation run and report markdown
modelsRouter.get('/eval/latest', async (req: Request, res: Response) => {
  try {
    const mlResponse = await fetch(`${config.mlServiceUrl}/eval/latest`);
    if (!mlResponse.ok) {
      const errData = await mlResponse.json().catch(() => ({}));
      return res.status(mlResponse.status).json({ error: errData.detail || 'Failed to fetch latest eval report' });
    }
    const data = await mlResponse.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({ error: `Could not reach ML service: ${err.message}` });
  }
});

// POST /api/models/eval/run - Trigger evaluation harness run
modelsRouter.post('/eval/run', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { snapshot, min_personal } = req.body || {};
    const mlResponse = await fetch(`${config.mlServiceUrl}/eval/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshot: snapshot || '2026-11-02',
        min_personal: min_personal !== undefined ? Number(min_personal) : 30,
      }),
    });
    const data = await mlResponse.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({ error: `Could not reach ML service: ${err.message}` });
  }
});
