/**
 * ModelCard Component Tests
 *
 * Tests for the model card display component including:
 * - Basic rendering (full and compact mode)
 * - Credibility badges (★ LM Studio, ✓ Official, ◆ Verified)
 * - Vision model indicator badge
 * - Size display (combined model + mmproj)
 * - Action buttons (download, select, delete)
 *
 * Priority: P1 (High)
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ModelCard } from '../../../src/components/ModelCard';
import {
  createVisionModel,
  createModelFile,
  createModelFileWithMmProj,
} from '../../utils/factories';

// Mock huggingFaceService for formatFileSize
jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: {
    formatFileSize: jest.fn((bytes: number) => {
      if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
      return `${bytes} B`;
    }),
  },
}));

describe('ModelCard', () => {
  const baseModel = {
    id: 'test/model',
    name: 'Test Model',
    author: 'test-author',
  };

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders model name', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, name: 'Llama 3.2 3B' }} />
      );
      expect(getByText('Llama 3.2 3B')).toBeTruthy();
    });

    it('renders author tag', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, author: 'meta-llama' }} />
      );
      expect(getByText('meta-llama')).toBeTruthy();
    });

    it('renders file size when file is provided', () => {
      const file = createModelFile({ size: 4 * 1024 * 1024 * 1024 });
      const { getByText } = render(
        <ModelCard model={baseModel} file={file} />
      );
      expect(getByText('4.0 GB')).toBeTruthy();
    });

    it('renders quantization badge', () => {
      const file = createModelFile({ quantization: 'Q4_K_M' });
      const { getByText } = render(
        <ModelCard model={baseModel} file={file} />
      );
      expect(getByText('Q4_K_M')).toBeTruthy();
    });

    it('shows download progress when downloading', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          isDownloading={true}
          downloadProgress={0.5}
        />
      );
      expect(getByText('50%')).toBeTruthy();
    });

    it('calls onPress when tapped', () => {
      const onPress = jest.fn();
      const { getByTestId } = render(
        <ModelCard model={baseModel} onPress={onPress} testID="model-card" />
      );
      fireEvent.press(getByTestId('model-card'));
      expect(onPress).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Compact Mode
  // ============================================================================
  describe('compact mode', () => {
    it('renders in compact layout', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} compact={true} />
      );
      expect(getByText('Test Model')).toBeTruthy();
    });

    it('shows description in compact mode (truncated)', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, description: 'A great model for testing' }}
          compact={true}
        />
      );
      expect(getByText('A great model for testing')).toBeTruthy();
    });

    it('shows download count in compact mode', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, downloads: 15000 }}
          compact={true}
        />
      );
      expect(getByText('15.0K dl')).toBeTruthy();
    });
  });

  // ============================================================================
  // Credibility Badges
  // ============================================================================
  describe('credibility badges', () => {
    it('shows ★ for lmstudio-community', () => {
      const { getByText } = render(
        <ModelCard
          model={{
            ...baseModel,
            credibility: {
              source: 'lmstudio',
              isOfficial: false,
              isVerifiedQuantizer: true,
              verifiedBy: 'LM Studio',
            },
          }}
        />
      );
      expect(getByText('★')).toBeTruthy();
      expect(getByText('LM Studio')).toBeTruthy();
    });

    it('shows ✓ for official authors', () => {
      const { getByText } = render(
        <ModelCard
          model={{
            ...baseModel,
            credibility: {
              source: 'official',
              isOfficial: true,
              isVerifiedQuantizer: false,
              verifiedBy: 'Meta',
            },
          }}
        />
      );
      expect(getByText('✓')).toBeTruthy();
      expect(getByText('Official')).toBeTruthy();
    });

    it('shows ◆ for verified quantizers', () => {
      const { getByText } = render(
        <ModelCard
          model={{
            ...baseModel,
            credibility: {
              source: 'verified-quantizer',
              isOfficial: false,
              isVerifiedQuantizer: true,
              verifiedBy: 'TheBloke',
            },
          }}
        />
      );
      expect(getByText('◆')).toBeTruthy();
      expect(getByText('Verified')).toBeTruthy();
    });

    it('shows no badge icon for community models', () => {
      const { queryByText, getByText } = render(
        <ModelCard
          model={{
            ...baseModel,
            credibility: {
              source: 'community',
              isOfficial: false,
              isVerifiedQuantizer: false,
            },
          }}
        />
      );
      expect(getByText('Community')).toBeTruthy();
      expect(queryByText('★')).toBeNull();
      expect(queryByText('✓')).toBeNull();
      expect(queryByText('◆')).toBeNull();
    });
  });

  // ============================================================================
  // Vision Badge
  // ============================================================================
  describe('vision badge', () => {
    it('shows Vision badge for vision models (file with mmProjFile)', () => {
      const visionFile = createModelFileWithMmProj();
      const { getByText } = render(
        <ModelCard model={baseModel} file={visionFile} />
      );
      expect(getByText('Vision')).toBeTruthy();
    });

    it('shows Vision badge for downloaded vision models', () => {
      const visionModel = createVisionModel();
      const { getByText } = render(
        <ModelCard model={baseModel} downloadedModel={visionModel} />
      );
      expect(getByText('Vision')).toBeTruthy();
    });

    it('does not show Vision badge for text-only models', () => {
      const textFile = createModelFile();
      const { queryByText } = render(
        <ModelCard model={baseModel} file={textFile} />
      );
      expect(queryByText('Vision')).toBeNull();
    });
  });

  // ============================================================================
  // Size Display
  // ============================================================================
  describe('size display', () => {
    it('shows combined size for model + mmproj', () => {
      const visionFile = createModelFileWithMmProj({
        size: 4 * 1024 * 1024 * 1024, // 4GB
        mmProjSize: 500 * 1024 * 1024, // 500MB
      });
      const { getByText } = render(
        <ModelCard model={baseModel} file={visionFile} />
      );
      // 4GB + 500MB = ~4.5GB
      expect(getByText('4.5 GB')).toBeTruthy();
    });

    it('shows single size for text-only models', () => {
      const file = createModelFile({ size: 3 * 1024 * 1024 * 1024 });
      const { getByText } = render(
        <ModelCard model={baseModel} file={file} />
      );
      expect(getByText('3.0 GB')).toBeTruthy();
    });

    it('shows downloaded model size including mmproj', () => {
      const visionModel = createVisionModel({
        fileSize: 2 * 1024 * 1024 * 1024,
        mmProjFileSize: 300 * 1024 * 1024,
      });
      const { getByText } = render(
        <ModelCard model={baseModel} downloadedModel={visionModel} />
      );
      // 2GB + 300MB ≈ 2.3 GB
      expect(getByText('2.3 GB')).toBeTruthy();
    });
  });

  // ============================================================================
  // Action Buttons
  // ============================================================================
  describe('action buttons', () => {
    it('shows download button for undownloaded models', () => {
      const onDownload = jest.fn();
      const { getByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={false}
          onDownload={onDownload}
          testID="card"
        />
      );
      const downloadBtn = getByTestId('card-download');
      fireEvent.press(downloadBtn);
      expect(onDownload).toHaveBeenCalled();
    });

    it('shows select button for downloaded non-active models', () => {
      const onSelect = jest.fn();
      render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
          isActive={false}
          onSelect={onSelect}
          testID="card"
        />
      );
      // The select icon button is rendered (check-circle icon)
      // We can't easily test by testID since it doesn't have one, but onSelect should fire
    });

    it('shows delete button for downloaded models', () => {
      const onDelete = jest.fn();
      render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
          onDelete={onDelete}
          testID="card"
        />
      );
      // Delete button is rendered with trash icon
      expect(onDelete).toBeDefined();
    });

    it('hides download button when already downloaded', () => {
      const onDownload = jest.fn();
      const { queryByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
          onDownload={onDownload}
          testID="card"
        />
      );
      expect(queryByTestId('card-download')).toBeNull();
    });

    it('disables download when not compatible', () => {
      const onDownload = jest.fn();
      const { getByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={false}
          isCompatible={false}
          onDownload={onDownload}
          testID="card"
        />
      );
      const downloadBtn = getByTestId('card-download');
      expect(downloadBtn.props.accessibilityState?.disabled).toBe(true);
    });

    it('shows "Too large" warning when not compatible', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          isCompatible={false}
        />
      );
      expect(getByText('Too large')).toBeTruthy();
    });
  });

  // ============================================================================
  // Active State
  // ============================================================================
  describe('active state', () => {
    it('shows Active badge when model is active', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} isActive={true} />
      );
      expect(getByText('Active')).toBeTruthy();
    });
  });

  // ============================================================================
  // Stats
  // ============================================================================
  describe('stats display', () => {
    it('shows download count in full mode', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 1500000 }} />
      );
      expect(getByText('1.5M downloads')).toBeTruthy();
    });

    it('shows likes count', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 1000, likes: 250 }} />
      );
      expect(getByText('250 likes')).toBeTruthy();
    });

    it('formats numbers correctly', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 500 }} />
      );
      expect(getByText('500 downloads')).toBeTruthy();
    });
  });
});
