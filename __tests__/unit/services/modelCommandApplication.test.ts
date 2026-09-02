import {
  mobileModelCommands,
  selectLocalTranscriptionModelOnDemand,
  selectLocalTextModelOnDemand,
} from '../../../src/services/modelServices/modelCommandApplication';

describe('Mobile text-model command boundary', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records selection without loading native model weights', async () => {
    const select = jest
      .spyOn(mobileModelCommands, 'select')
      .mockResolvedValue(undefined);

    await selectLocalTextModelOnDemand({ id: 'qwen-local', engine: 'llama' });

    expect(select).toHaveBeenCalledWith(
      {
        source: 'local',
        hostId: 'llama',
        modality: 'text',
        modelId: 'qwen-local',
      },
      { load: false },
    );
  });

  it('records and clears Whisper selection through the canonical command service', async () => {
    const select = jest
      .spyOn(mobileModelCommands, 'select')
      .mockResolvedValue(undefined);
    const unload = jest
      .spyOn(mobileModelCommands, 'unload')
      .mockResolvedValue(undefined);

    await selectLocalTranscriptionModelOnDemand('large-v3-turbo');
    await selectLocalTranscriptionModelOnDemand(null);

    expect(select).toHaveBeenCalledWith(
      {
        source: 'local',
        hostId: 'whisper.rn',
        modality: 'transcription',
        modelId: 'large-v3-turbo',
      },
      { load: false },
    );
    expect(unload).toHaveBeenCalledWith('transcription');
  });
});
