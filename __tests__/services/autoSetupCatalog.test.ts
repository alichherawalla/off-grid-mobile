import { RECOMMENDED_MODELS } from '../../src/constants';
import { buildAutoSetupTextCandidates } from '../../src/services/autoSetupCatalog';
import { selectAutoSetupPlans } from '../../src/services/autoSetupPlan';
import { recommendedModelsForDevice } from '../../src/utils/recommendedModels';

const GB = 1024 ** 3;

test('an iPhone 17 Pro Max gets 2B, 4B, and Qwen 3.5 9B setup choices', () => {
  const files = Object.fromEntries(RECOMMENDED_MODELS.map(model => [model.id, [{
    name: `${model.params}B-Q4_K_M.gguf`,
    size: model.params * 0.6 * GB,
    quantization: 'Q4_K_M',
    downloadUrl: `https://boundary.test/${model.id}`,
    mmProjFile: {
      name: 'mmproj-F16.gguf',
      size: 0.8 * GB,
      downloadUrl: `https://boundary.test/${model.id}/mmproj`,
    },
  }]]));

  const catalog = buildAutoSetupTextCandidates(recommendedModelsForDevice(12), files, 12);
  const image = [{ id: 'image', name: 'Image', kind: 'image' as const, sizeBytes: 1, fitScore: 0, payload: {} as never }];
  const stt = [{ id: 'stt', name: 'Speech', kind: 'stt' as const, sizeBytes: 1, fitScore: 0, payload: { modelId: 'stt' } }];
  const plans = selectAutoSetupPlans({ text: catalog, image, stt });

  expect(plans.map(plan => plan.items[0].name)).toEqual([
    'Gemma 4 E2B',
    'Gemma 4 E4B',
    'Qwen 3.5 9B',
  ]);
});
