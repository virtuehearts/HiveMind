export type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  pricing?: { prompt?: number; completion?: number };
  provider?: { name?: string };
};

export async function fetchFreeOpenRouterModels(apiKey?: string): Promise<OpenRouterModel[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const response = await fetch('https://openrouter.ai/api/v1/models?max_price=0', {
    headers
  });

  if (!response.ok) {
    throw new Error('Unable to load OpenRouter models');
  }

  const payload = await response.json();
  const models = Array.isArray(payload.data) ? payload.data : [];

  return models
    .map((entry: any) => {
      const id = entry.id || entry.name || entry.slug;
      return {
        id,
        name: entry.name || entry.display_name || id,
        description: entry.description,
        pricing: entry.pricing,
        provider: entry.provider
      } as OpenRouterModel;
    })
    .filter((model: OpenRouterModel) => Boolean(model.id));
}
