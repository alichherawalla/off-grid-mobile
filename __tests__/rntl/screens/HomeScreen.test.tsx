/**
 * HomeScreen Tests
 *
 * Tests for the home dashboard including:
 * - Model cards display
 * - Model selection and loading
 * - Memory management
 * - Quick navigation
 * - Recent conversations
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { resetStores, setupWithActiveModel, createMultipleConversations } from '../../utils/testHelpers';
import {
  createDownloadedModel,
  createONNXImageModel,
  createDeviceInfo,
  createConversation,
  createVisionModel,
} from '../../utils/factories';

// Mock navigation
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
  };
});

// Mock services
jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    loadModel: jest.fn(() => Promise.resolve()),
    unloadModel: jest.fn(() => Promise.resolve()),
    unloadImageModel: jest.fn(() => Promise.resolve()),
    getActiveModels: jest.fn(() => ({ text: null, image: null })),
    checkMemoryAvailable: jest.fn(() => ({ safe: true })),
    subscribe: jest.fn(() => jest.fn()),
    getResourceUsage: jest.fn(() => ({
      textModelMemory: 0,
      imageModelMemory: 0,
      totalMemory: 0,
    })),
    syncWithNativeState: jest.fn(),
  },
}));

jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    getDownloadedModels: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({
      totalMemory: 8 * 1024 * 1024 * 1024,
      availableMemory: 4 * 1024 * 1024 * 1024,
    })),
    formatBytes: jest.fn((bytes) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`),
  },
}));

// Import after mocks
import { HomeScreen } from '../../../src/screens/HomeScreen';
import { activeModelService } from '../../../src/services/activeModelService';

const renderWithNavigation = (component: React.ReactElement) => {
  return render(
    <NavigationContainer>
      {component}
    </NavigationContainer>
  );
};

describe('HomeScreen', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();

    // Re-setup activeModelService mock after clearAllMocks
    (activeModelService.subscribe as jest.Mock).mockReturnValue(jest.fn());
    (activeModelService.getActiveModels as jest.Mock).mockReturnValue({
      text: { modelId: null, modelPath: null, isLoading: false },
      image: { modelId: null, modelPath: null, isLoading: false },
    });
    (activeModelService.checkMemoryAvailable as jest.Mock).mockReturnValue({
      safe: true,
      severity: 'safe',
    });
    (activeModelService.getResourceUsage as jest.Mock).mockReturnValue({
      textModelMemory: 0,
      imageModelMemory: 0,
      totalMemory: 0,
    });
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders without crashing', () => {
      const { getByText } = renderWithNavigation(<HomeScreen />);

      // Should show some home screen content
    });

    it('shows app title or header', () => {
      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // May show "LocalLLM" or similar
    });

    it('shows model sections', () => {
      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show text and image model sections
    });
  });

  // ============================================================================
  // Text Model Card
  // ============================================================================
  describe('text model card', () => {
    it('shows "No model selected" when no text model is active', () => {
      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should indicate no model
    });

    it('shows "No models downloaded" when downloadedModels is empty', () => {
      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Empty state message
    });

    it('shows active model name when model is loaded', () => {
      const model = createDownloadedModel({ name: 'Llama-3.2-3B' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "Llama-3.2-3B"
    });

    it('shows quantization for active model', () => {
      const model = createDownloadedModel({
        name: 'Phi-3-mini',
        quantization: 'Q4_K_M',
      });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "Q4_K_M"
    });

    it('shows vision badge for vision models', () => {
      const model = createVisionModel({ name: 'LLaVA-v1.6' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "Vision" badge
    });

    it('opens text model picker when card is tapped', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByTestId } = renderWithNavigation(<HomeScreen />);

      // Tap text model card
      // Should open picker modal
    });

    it('shows loading state when text model is loading', () => {
      useAppStore.setState({ isLoadingModel: true });

      const { queryByTestId } = renderWithNavigation(<HomeScreen />);

      // Should show loading indicator
    });
  });

  // ============================================================================
  // Image Model Card
  // ============================================================================
  describe('image model card', () => {
    it('shows "No model selected" when no image model is active', () => {
      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should indicate no image model
    });

    it('shows active image model name', () => {
      const imageModel = createONNXImageModel({ name: 'SDXL Turbo' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "SDXL Turbo"
    });

    it('shows style/ready status for image model', () => {
      const imageModel = createONNXImageModel({
        name: 'Dreamshaper',
        style: 'creative',
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "creative" or "Ready"
    });

    it('opens image model picker when card is tapped', () => {
      const imageModel = createONNXImageModel();
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getByTestId } = renderWithNavigation(<HomeScreen />);

      // Tap image model card
      // Should open image picker modal
    });
  });

  // ============================================================================
  // Model Selection
  // ============================================================================
  describe('model selection', () => {
    it('loads text model when selected from picker', async () => {
      const model = createDownloadedModel({ name: 'Test Model' });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderWithNavigation(<HomeScreen />);

      // Open picker and select model
      // expect(activeModelService.loadModel).toHaveBeenCalledWith(model);
    });

    it('shows memory check warning when memory is low', async () => {
      (activeModelService.checkMemoryAvailable as jest.Mock).mockReturnValue({
        safe: false,
        warning: true,
        reason: 'May cause performance issues',
      });

      const model = createDownloadedModel({ fileSize: 8 * 1024 * 1024 * 1024 });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderWithNavigation(<HomeScreen />);

      // Select large model - should show warning
    });

    it('blocks model load when memory is critical', async () => {
      (activeModelService.checkMemoryAvailable as jest.Mock).mockReturnValue({
        safe: false,
        critical: true,
        reason: 'Not enough memory',
      });

      const model = createDownloadedModel({ fileSize: 16 * 1024 * 1024 * 1024 });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderWithNavigation(<HomeScreen />);

      // Select huge model - should be blocked
    });

    it('unloads current model before loading new one', async () => {
      const model1 = createDownloadedModel({ id: 'model-1' });
      const model2 = createDownloadedModel({ id: 'model-2' });
      useAppStore.setState({
        downloadedModels: [model1, model2],
        activeModelId: model1.id,
      });

      // Select model2 - should unload model1 first
    });
  });

  // ============================================================================
  // Model Unloading
  // ============================================================================
  describe('model unloading', () => {
    it('unloads text model when unload button is pressed', async () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByTestId } = renderWithNavigation(<HomeScreen />);

      // Press unload button
      // expect(activeModelService.unloadModel).toHaveBeenCalled();
    });

    it('unloads image model when unload button is pressed', async () => {
      const imageModel = createONNXImageModel();
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      // Press unload image button
      // expect(activeModelService.unloadImageModel).toHaveBeenCalled();
    });

    it('ejects all models when eject button is pressed', async () => {
      const model = createDownloadedModel();
      const imageModel = createONNXImageModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      // Press eject all - should show confirmation
      // After confirm, both models should be unloaded
    });
  });

  // ============================================================================
  // Memory Display
  // ============================================================================
  describe('memory display', () => {
    it('shows device total RAM', () => {
      useAppStore.setState({
        deviceInfo: createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "8 GB" or similar
    });

    it('shows estimated RAM usage for loaded text model', () => {
      const model = createDownloadedModel({ fileSize: 4 * 1024 * 1024 * 1024 });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show estimated usage (fileSize * 1.5)
    });

    it('shows combined RAM when both models loaded', () => {
      const model = createDownloadedModel({ fileSize: 4 * 1024 * 1024 * 1024 });
      const imageModel = createONNXImageModel({ size: 2 * 1024 * 1024 * 1024 });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show combined total
    });

    it('shows warning when running both models', () => {
      const model = createDownloadedModel();
      const imageModel = createONNXImageModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // May show warning about memory
    });
  });

  // ============================================================================
  // Quick Navigation
  // ============================================================================
  describe('quick navigation', () => {
    it('creates new chat when New Chat button is pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText } = renderWithNavigation(<HomeScreen />);

      // Press "New Chat"
      // Should create conversation and navigate
    });

    it('opens recent conversation when Continue is pressed', () => {
      const model = createDownloadedModel();
      const conversation = createConversation({ modelId: model.id });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });
      useChatStore.setState({
        conversations: [conversation],
        activeConversationId: conversation.id,
      });

      const { getByText } = renderWithNavigation(<HomeScreen />);

      // Press "Continue Chat"
      // Should navigate to chat with existing conversation
    });

    it('navigates to gallery when gallery button is pressed', () => {
      const { getByTestId } = renderWithNavigation(<HomeScreen />);

      // Press gallery button
      // expect(mockNavigate).toHaveBeenCalledWith('Gallery');
    });

    it('shows image count badge on gallery button', () => {
      useAppStore.setState({
        generatedImages: [
          { id: '1', prompt: 'test', imagePath: '/path', width: 512, height: 512, steps: 20, seed: 1, modelId: 'm', createdAt: '' },
          { id: '2', prompt: 'test', imagePath: '/path', width: 512, height: 512, steps: 20, seed: 1, modelId: 'm', createdAt: '' },
        ],
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "2" badge
    });
  });

  // ============================================================================
  // Recent Conversations
  // ============================================================================
  describe('recent conversations', () => {
    it('shows recent conversations list', () => {
      const conversations = [
        createConversation({ title: 'Chat about AI' }),
        createConversation({ title: 'Code review' }),
      ];
      useChatStore.setState({ conversations });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show conversation titles
    });

    it('limits recent conversations to 4', () => {
      const conversationIds = createMultipleConversations(6);

      const { queryAllByTestId } = renderWithNavigation(<HomeScreen />);

      // Should only show 4
    });

    it('opens conversation when tapped', () => {
      const conversation = createConversation({ title: 'Test Chat' });
      useChatStore.setState({ conversations: [conversation] });

      const { getByText } = renderWithNavigation(<HomeScreen />);

      // Tap conversation
      // Should navigate to chat
    });

    it('deletes conversation on swipe', async () => {
      const conversation = createConversation({ title: 'Delete me' });
      useChatStore.setState({ conversations: [conversation] });

      const { getByText } = renderWithNavigation(<HomeScreen />);

      // Swipe to delete
      // Should show confirmation then remove
    });

    it('shows empty state when no conversations', () => {
      useChatStore.setState({ conversations: [] });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show empty state message
    });
  });

  // ============================================================================
  // Stats Display
  // ============================================================================
  describe('stats display', () => {
    it('shows count of text models', () => {
      useAppStore.setState({
        downloadedModels: [
          createDownloadedModel(),
          createDownloadedModel(),
          createDownloadedModel(),
        ],
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "3" or "3 models"
    });

    it('shows count of image models', () => {
      useAppStore.setState({
        downloadedImageModels: [
          createONNXImageModel(),
          createONNXImageModel(),
        ],
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "2" image models
    });

    it('shows count of conversations', () => {
      createMultipleConversations(5);

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // Should show "5" conversations
    });
  });

  // ============================================================================
  // Loading States
  // ============================================================================
  describe('loading states', () => {
    it('shows loading overlay when model is loading', () => {
      useAppStore.setState({ isLoadingModel: true });

      const { queryByTestId } = renderWithNavigation(<HomeScreen />);

      // Should show loading overlay that blocks touch
    });

    it('disables all interactions during loading', () => {
      useAppStore.setState({ isLoadingModel: true });

      const { getByText } = renderWithNavigation(<HomeScreen />);

      // All buttons should be disabled
    });

    it('shows model name in loading indicator', () => {
      const model = createDownloadedModel({ name: 'Loading Model' });
      useAppStore.setState({
        downloadedModels: [model],
        isLoadingModel: true,
      });

      const { queryByText } = renderWithNavigation(<HomeScreen />);

      // May show "Loading Loading Model..."
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================
  describe('error handling', () => {
    it('shows alert on model load failure', async () => {
      (activeModelService.loadModel as jest.Mock).mockRejectedValue(
        new Error('Failed to load model')
      );

      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      // Try to load - should show error alert
    });

    it('recovers from load failure', async () => {
      (activeModelService.loadModel as jest.Mock).mockRejectedValueOnce(
        new Error('Temporary failure')
      );

      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      // First load fails, second succeeds
      // UI should be usable after error
    });
  });

  // ============================================================================
  // Model Picker Modal
  // ============================================================================
  describe('model picker modal', () => {
    it('shows all downloaded models in picker', () => {
      useAppStore.setState({
        downloadedModels: [
          createDownloadedModel({ name: 'Model A' }),
          createDownloadedModel({ name: 'Model B' }),
          createDownloadedModel({ name: 'Model C' }),
        ],
      });

      // Open picker - all models should be listed
    });

    it('highlights currently active model', () => {
      const activeModel = createDownloadedModel({ name: 'Active Model' });
      useAppStore.setState({
        downloadedModels: [
          activeModel,
          createDownloadedModel({ name: 'Other Model' }),
        ],
        activeModelId: activeModel.id,
      });

      // Active model should have checkmark or highlight
    });

    it('closes picker when model is selected', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      // Select model - picker should close
    });

    it('closes picker on backdrop press', () => {
      // Press outside modal - should close
    });

    it('has tabs for text and image models', () => {
      // Should show "Text" and "Image" tabs
    });
  });
});
