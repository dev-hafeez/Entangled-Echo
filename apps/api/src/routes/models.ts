import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { config } from '../config.js';

export const modelsRouter = Router();

// GET /api/models - List all trained models
modelsRouter.get('/', async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data: models, error } = await supabase
    .from('models')
    .select(`
      *,
      accounts (
        handle
      )
    `)
    .order('trained_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ models });
});

// POST /api/models/train-global - Trigger training of global model
modelsRouter.post('/train-global', async (req: Request, res: Response) => {
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

    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({
      error: `Could not reach ML service at ${config.mlServiceUrl}: ${err.message}`,
    });
  }
});

// POST /api/models/train-personal/:handle - Trigger training of personal model
modelsRouter.post('/train-personal/:handle', async (req: Request, res: Response) => {
  const { handle } = req.params;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');

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
modelsRouter.post('/predict', async (req: Request, res: Response) => {
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

    // Log prediction in database
    const supabase = getSupabaseAdmin();
    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('handle', cleanHandle)
      .single();

    await supabase.from('predictions').insert({
      account_id: account?.id || null,
      model_id: data.model_id || null,
      input_features: {
        handle: cleanHandle,
        caption,
        media_type: mediaType,
        planned_time: plannedTime,
      },
      predicted_engagement_rate: data.predicted_engagement_rate,
      model_used: data.model_used,
      confidence_note: data.confidence_note,
      top_features: data.top_features,
    });

    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({
      error: `Could not reach ML service at ${config.mlServiceUrl}: ${err.message}`,
    });
  }
});

// DELETE /api/models/:id - Delete a model record and its stored artifact
modelsRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const supabase = getSupabaseAdmin();

  // Find model
  const { data: model, error: findErr } = await supabase
    .from('models')
    .select('*')
    .eq('id', id)
    .single();

  if (findErr || !model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  // Delete artifact from Supabase Storage
  if (model.artifact_path) {
    try {
      await supabase.storage.from('model-artifacts').remove([model.artifact_path]);
    } catch (err: any) {
      console.warn(`[storage] Could not delete model artifact: ${err.message}`);
    }
  }

  // Delete model record from models table
  const { error: delErr } = await supabase
    .from('models')
    .delete()
    .eq('id', id);

  if (delErr) {
    return res.status(500).json({ error: delErr.message });
  }

  return res.json({
    success: true,
    message: `Model ${model.version} (${model.model_type}) deleted successfully.`,
  });
});
