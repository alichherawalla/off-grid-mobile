/**
 * ImageGenAdviceCard — in-chat GPU-path speed/quality guidance. Renders nothing off the
 * mnn path or at good settings; shows the right tips (raise steps / lower size / raise
 * size) when the live settings warrant it; is dismissible. Drives the REAL store + rule.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

jest.mock('react-native-vector-icons/Feather', () => 'Icon');

let applicationFixture: import('../../harness/mobileApplicationFixture').MobileApplicationFixture;
let React: typeof import('react');
let rtl: typeof import('@testing-library/react-native');
let ImageGenAdviceCard: typeof import('../../../src/components/ImageGenAdviceCard').ImageGenAdviceCard;
let useAppStore: typeof import('../../../src/stores').useAppStore;

const setup = async (
  backend: string | undefined,
  imageSteps: number | undefined,
  imageWidth: number | undefined,
) => {
  rtl = requireRTL();
  await applicationFixture.application.models.select({
    modality: 'image',
    modelId: null,
  });
  useAppStore.setState({
    downloadedImageModels: backend
      ? [
          createONNXImageModel({
            id: 'img',
            name: 'M',
            modelPath: '/m',
            backend: backend as never,
          }),
        ]
      : [],
    settings: {
      ...useAppStore.getState().settings,
      imageSteps,
      imageWidth,
      imageHeight: imageWidth,
    } as any,
  });
  await applicationFixture.refreshModels();
  if (backend) {
    const routeId = applicationFixture.application.models.resolveRoute(
      'image',
      'img',
    );
    expect(routeId).not.toBeNull();
    const selected = await applicationFixture.application.models.select({
      modality: 'image',
      modelId: routeId,
    });
    expect(selected.ok).toBe(true);
  }
};

describe('ImageGenAdviceCard', () => {
  beforeAll(async () => {
    installNativeBoundary({ fs: true });
    React = require('react');
    rtl = requireRTL();
    ({ useAppStore } =
      require('../../../src/stores') as typeof import('../../../src/stores'));
    ({ ImageGenAdviceCard } =
      require('../../../src/components/ImageGenAdviceCard') as typeof import('../../../src/components/ImageGenAdviceCard'));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture();
  });

  afterAll(async () => {
    await applicationFixture.dispose();
  });

  it('renders nothing on the NPU (qnn) path', async () => {
    await setup('qnn', 8, 512);
    expect(
      rtl
        .render(React.createElement(ImageGenAdviceCard))
        .queryByTestId('image-gen-advice'),
    ).toBeNull();
  });

  it('renders nothing at the sweet spot (mnn, 22 steps, 256)', async () => {
    await setup('mnn', 22, 256);
    expect(
      rtl
        .render(React.createElement(ImageGenAdviceCard))
        .queryByTestId('image-gen-advice'),
    ).toBeNull();
  });

  it('shows the raise-steps tip on the GPU path at low steps', async () => {
    await setup('mnn', 8, 256);
    const { getByTestId, queryByTestId } = rtl.render(
      React.createElement(ImageGenAdviceCard),
    );
    expect(getByTestId('image-gen-advice')).toBeTruthy();
    expect(getByTestId('image-gen-advice-steps')).toBeTruthy();
    expect(queryByTestId('image-gen-advice-size')).toBeNull();
  });

  it('shows the lower-size tip when too large (512)', async () => {
    await setup('mnn', 22, 512);
    expect(
      rtl
        .render(React.createElement(ImageGenAdviceCard))
        .getByTestId('image-gen-advice-size'),
    ).toBeTruthy();
  });

  it('shows the raise-size (garbage) tip when below 256 (the 128 case)', async () => {
    await setup('mnn', 22, 128);
    const { getByTestId, queryByTestId } = rtl.render(
      React.createElement(ImageGenAdviceCard),
    );
    expect(getByTestId('image-gen-advice-raise-size')).toBeTruthy();
    expect(queryByTestId('image-gen-advice-size')).toBeNull();
  });

  it('can be dismissed (session) — hides after tapping X', async () => {
    await setup('mnn', 8, 256);
    const { getByTestId, queryByTestId } = rtl.render(
      React.createElement(ImageGenAdviceCard),
    );
    rtl.fireEvent.press(getByTestId('image-gen-advice-dismiss'));
    expect(queryByTestId('image-gen-advice')).toBeNull();
  });

  it('treats undefined steps/size as 0 without crashing (nullish fallback branch)', async () => {
    await setup('mnn', undefined, undefined);
    // width 0 => not >256 and not (0<256 && >0) => no size tip; steps 0 (<20) => raiseSteps.
    const { getByTestId, queryByTestId } = rtl.render(
      React.createElement(ImageGenAdviceCard),
    );
    expect(getByTestId('image-gen-advice-steps')).toBeTruthy();
    expect(queryByTestId('image-gen-advice-raise-size')).toBeNull();
  });
});
