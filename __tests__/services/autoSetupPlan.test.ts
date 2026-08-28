import { selectAutoSetupPlans, type AutoSetupCompatibleCatalog } from '../../src/services/autoSetupPlan';

const candidate = (kind: 'text' | 'image' | 'stt', name: string, sizeBytes: number, fitScore: number, parameterCountB?: number) => ({
  id: `${kind}-${name}`,
  name,
  kind,
  sizeBytes,
  fitScore,
  parameterCountB,
  payload: kind === 'text'
    ? { modelId: name, file: { name: `${name}.gguf`, size: sizeBytes, quantization: 'Q4_K_M', downloadUrl: 'https://boundary.test/text' } }
    : kind === 'image'
      ? { id: `${kind}-${name}`, name, description: name, size: sizeBytes, downloadUrl: 'https://boundary.test/image', style: 'general', backend: 'mnn' }
      : { modelId: `${kind}-${name}` },
});

test('Lean, Balanced, and Extreme select only from the compatible device catalog', () => {
  const catalog = {
    text: [candidate('text', 'small', 100, 4, 2), candidate('text', 'fit', 200, 0, 4), candidate('text', 'large', 300, 2, 9)],
    image: [candidate('image', 'small', 10, 4), candidate('image', 'fit', 20, 0), candidate('image', 'large', 30, 2)],
    stt: [candidate('stt', 'small', 1, 4), candidate('stt', 'fit', 2, 0), candidate('stt', 'large', 3, 2)],
  } as AutoSetupCompatibleCatalog;

  const plans = selectAutoSetupPlans(catalog);
  expect(plans.map(plan => [plan.tier, ...plan.items.map(item => item.name)])).toEqual([
    ['lean', 'small', 'small', 'small'],
    ['balanced', 'fit', 'fit', 'fit'],
    ['extreme', 'large', 'large', 'large'],
  ]);
  expect(plans[1].totalBytes).toBe(222);
});

test('text plans target 2B, 4B, and 9B instead of file-size order', () => {
  const catalog = {
    text: [
      candidate('text', 'Qwen 0.8B', 80, 0, 0.8),
      candidate('text', 'Qwen 9B', 500, 3, 9),
      candidate('text', 'Gemma 4B', 900, 2, 4),
      candidate('text', 'Gemma 2B', 700, 1, 2),
    ],
    image: [candidate('image', 'image', 10, 0)],
    stt: [candidate('stt', 'speech', 1, 0)],
  } as AutoSetupCompatibleCatalog;

  const plans = selectAutoSetupPlans(catalog);
  expect(plans.map(plan => plan.items[0].name)).toEqual(['Gemma 2B', 'Gemma 4B', 'Qwen 9B']);
});

test('no plan is forced when one compatible model kind is absent', () => {
  const catalog = { text: [candidate('text', 'fit', 2, 0)], image: [], stt: [candidate('stt', 'fit', 1, 0)] } as AutoSetupCompatibleCatalog;
  expect(selectAutoSetupPlans(catalog)).toEqual([]);
});
