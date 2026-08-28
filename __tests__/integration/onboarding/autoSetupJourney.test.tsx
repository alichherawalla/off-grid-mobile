import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AutoSetupScreen } from '../../../src/screens/AutoSetupScreen';

let mockLiveDownloads: any[] = [];
const mockStartPlan = jest.fn().mockResolvedValue(undefined);
const mockCompletePlan = jest.fn();

const makeCandidate = (kind: 'text' | 'image' | 'stt', tier: string, size: number) => ({
  id: kind === 'text' ? `repo/${tier}.gguf` : `${kind}-${tier}`,
  name: `${tier} ${kind}`,
  kind,
  sizeBytes: size,
  fitScore: tier === 'balanced' ? 0 : tier === 'lean' ? 1 : 2,
  payload: kind === 'text'
    ? { modelId: 'repo', file: { name: `${tier}.gguf`, size, quantization: 'Q4_K_M', downloadUrl: 'https://boundary.test/text' } }
    : kind === 'image'
      ? { id: `image-${tier}`, name: tier, description: tier, size, downloadUrl: 'https://boundary.test/image', style: 'general', backend: 'mnn' }
      : { modelId: `stt-${tier}` },
});

const mockCatalog = {
  text: ['lean', 'balanced', 'extreme'].map((tier, index) => makeCandidate('text', tier, 100 + index)),
  image: ['lean', 'balanced', 'extreme'].map((tier, index) => makeCandidate('image', tier, 10 + index)),
  stt: ['lean', 'balanced', 'extreme'].map((tier, index) => makeCandidate('stt', tier, 1 + index)),
};

jest.mock('../../../src/services/autoSetupCatalog', () => ({
  loadAutoSetupCompatibleCatalog: () => Promise.resolve(mockCatalog),
}));
jest.mock('../../../src/services/autoSetupService', () => ({
  startAutoSetupPlan: (...args: any[]) => mockStartPlan(...args),
  completeAutoSetupPlan: (...args: any[]) => mockCompletePlan(...args),
}));
jest.mock('../../../src/services/modelDownloadService/useModelDownloads', () => ({
  useModelDownloads: () => mockLiveDownloads,
}));

const navigation = { navigate: jest.fn(), replace: jest.fn() } as any;

describe('Auto Setup rendered release journey', () => {
  beforeEach(() => {
    mockLiveDownloads = [];
    jest.clearAllMocks();
  });

  it('chooses a plan, starts one combined download, retries only missing work, then continues', async () => {
    const ui = render(<AutoSetupScreen navigation={navigation} />);
    await waitFor(() => expect(ui.getByTestId('auto-setup-plan-balanced')).toBeTruthy());

    expect(ui.getAllByText('INCLUDES')).toHaveLength(3);
    expect(ui.getByText('lean text')).toBeTruthy();
    expect(ui.getByText('balanced text')).toBeTruthy();
    expect(ui.getByText('extreme text')).toBeTruthy();
    expect(ui.queryByText('Balanced includes')).toBeNull();

    fireEvent.press(ui.getByTestId('auto-setup-plan-extreme'));
    expect(ui.getByText('SELECTED SETUP')).toBeTruthy();
    expect(ui.getAllByText('Extreme')).toHaveLength(2);
    fireEvent.press(ui.getByTestId('auto-setup-download'));
    await waitFor(() => expect(mockStartPlan).toHaveBeenCalledWith(expect.objectContaining({ tier: 'extreme' }), new Set()));

    mockLiveDownloads = [
      { id: 'text:repo/extreme.gguf', status: 'completed', progress: 1 },
      { id: 'image:image-extreme', status: 'error', progress: 0.4, error: 'Network stopped' },
    ];
    ui.rerender(<AutoSetupScreen navigation={navigation} />);
    fireEvent.press(ui.getByTestId('auto-setup-download'));
    await waitFor(() => expect(mockStartPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ tier: 'extreme' }),
      new Set(['text:repo/extreme.gguf']),
    ));

    mockLiveDownloads = [
      { id: 'text:repo/extreme.gguf', status: 'completed', progress: 1 },
      { id: 'image:image-extreme', status: 'completed', progress: 1 },
      { id: 'stt:stt-extreme', status: 'completed', progress: 1 },
    ];
    ui.rerender(<AutoSetupScreen navigation={navigation} />);
    fireEvent.press(ui.getByTestId('auto-setup-continue'));
    expect(mockCompletePlan).toHaveBeenCalledWith(expect.objectContaining({ tier: 'extreme' }));
    expect(navigation.replace).toHaveBeenCalledWith('Main');
  });

  it('hands manual model and remote-server setup to Advanced', async () => {
    const ui = render(<AutoSetupScreen navigation={navigation} />);
    await waitFor(() => expect(ui.getByTestId('auto-setup-advanced')).toBeTruthy());
    fireEvent.press(ui.getByTestId('auto-setup-advanced'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdvancedSetup');
  });
});
