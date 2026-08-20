import { DEFAULT_SEARCH_VECTOR_MODEL_ID } from '../../constants/search-model.ts';

const STATIC_MODEL_DIMENSIONS = new Map<string, number>([
  [DEFAULT_SEARCH_VECTOR_MODEL_ID.toLowerCase(), 256],
  ['minishlab/potion-base-2m', 64],
  ['minishlab/potion-base-4m', 128],
  ['minishlab/potion-base-8m', 256],
]);

export function getEmbeddingDimensionHint(modelId: string): number {
  const normalized = modelId.trim().toLowerCase();
  const staticDimension = STATIC_MODEL_DIMENSIONS.get(normalized);
  if (staticDimension !== undefined) return staticDimension;
  return 0;
}
