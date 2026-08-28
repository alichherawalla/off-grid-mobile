import { selectAutoSetupPlans, type AutoSetupCompatibleCatalog } from '../../src/services/autoSetupPlan';

const candidate = (kind: 'text' | 'image' | 'stt', name: string, sizeBytes: number, fitScore: number) => ({
  id: `${kind}-${name}`,
  name,
  kind,
  sizeBytes,
  fitScore,
  payload: kind === 'text'
    ? { modelId: name, file: { name: `${name}.gguf`, size: sizeBytes, quantization: 'Q4_K_M', downloadUrl: 'https://boundary.test/text' } }
    : kind === 'image'
      ? { id: `${kind}-${name}`, name, description: name, size: sizeBytes, downloadUrl: 'https://boundary.test/image', style: 'general', backend: 'mnn' }
      : { modelId: `${kind}-${name}` },
});

test('Lean, Balanced, and Extreme select only from the compatible device catalog', () => {
  const catalog = {
    text: [candidate('text', 'small', 100, 4), candidate('text', 'fit', 200, 0), candidate('text', 'large', 300, 2)],
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

test('no plan is forced when one compatible model kind is absent', () => {
  const catalog = { text: [candidate('text', 'fit', 2, 0)], image: [], stt: [candidate('stt', 'fit', 1, 0)] } as AutoSetupCompatibleCatalog;
  expect(selectAutoSetupPlans(catalog)).toEqual([]);
});
