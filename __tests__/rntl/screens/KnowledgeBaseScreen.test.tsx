/**
 * KnowledgeBaseScreen Tests
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: jest.fn(),
    }),
    useRoute: () => ({
      params: { projectId: 'proj1' },
    }),
  };
});

const mockGetDocumentsByProject = jest.fn<Promise<any[]>, [string]>(() => Promise.resolve([]));
const mockIndexDocument = jest.fn<Promise<number>, [any]>(() => Promise.resolve(1));
const mockDeleteDocument = jest.fn<Promise<void>, [number]>(() => Promise.resolve());
const mockToggleDocument = jest.fn<Promise<void>, [number, boolean]>(() => Promise.resolve());

jest.mock('../../../src/services/rag', () => ({
  ragService: {
    getDocumentsByProject: (projectId: string) => mockGetDocumentsByProject(projectId),
    indexDocument: (params: any) => mockIndexDocument(params),
    deleteDocument: (docId: number) => mockDeleteDocument(docId),
    toggleDocument: (docId: number, enabled: boolean) => mockToggleDocument(docId, enabled),
    ensureReady: jest.fn(() => Promise.resolve()),
  },
}));

let mockProject: any = { id: 'proj1', name: 'My Project' };

jest.mock('../../../src/stores', () => ({
  useProjectStore: jest.fn((selector?: any) => {
    const state = { getProject: () => mockProject };
    return selector ? selector(state) : state;
  }),
  useChatStore: jest.fn(() => ({})),
  useAppStore: jest.fn(() => ({})),
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(() => Promise.resolve([{
    uri: 'file:///mock/doc.txt',
    name: 'doc.txt',
    size: 1000,
  }])),
  keepLocalCopy: jest.fn(() => Promise.resolve([{ status: 'success', localUri: '/mock/local/doc.txt' }])),
}));

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

import { KnowledgeBaseScreen } from '../../../src/screens/KnowledgeBaseScreen';

const flushPromises = () => act(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
});

describe('KnowledgeBaseScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProject = { id: 'proj1', name: 'My Project' };
    mockGetDocumentsByProject.mockResolvedValue([]);
  });

  describe('basic rendering', () => {
    it('renders the screen and shows project name', async () => {
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      expect(getByText('My Project')).toBeTruthy();
    });

    it('shows fallback title when project is null', async () => {
      mockProject = null;
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      expect(getByText('Knowledge Base')).toBeTruthy();
    });

    it('shows loading indicator initially', () => {
      const { getByLabelText } = render(<KnowledgeBaseScreen />);
      // The one loader in this app announces itself as "Working". Asserted by what a user
      // perceives rather than by component type, so replacing the loader again cannot break this.
      expect(getByLabelText('Working')).toBeTruthy();
    });

    it('shows empty state when no documents', async () => {
      mockGetDocumentsByProject.mockResolvedValue([]);
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      expect(getByText('No documents yet')).toBeTruthy();
    });
  });

  describe('with documents', () => {
    const docs: any[] = [
      { id: 1, name: 'readme.txt', path: '/docs/readme.txt', size: 500, enabled: 1, projectId: 'proj1', createdAt: '' },
      { id: 2, name: 'notes.pdf', path: '/docs/notes.pdf', size: 2048 * 1024, enabled: 0, projectId: 'proj1', createdAt: '' },
    ];

    beforeEach(() => {
      mockGetDocumentsByProject.mockResolvedValue(docs);
    });

    it('renders document names', async () => {
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      expect(getByText('readme.txt')).toBeTruthy();
      expect(getByText('notes.pdf')).toBeTruthy();
    });

    it('formats file sizes correctly', async () => {
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      expect(getByText('500 B')).toBeTruthy();
      expect(getByText('2.0 MB')).toBeTruthy();
    });

    it('navigates to DocumentPreview when doc is pressed', async () => {
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      fireEvent.press(getByText('readme.txt'));
      expect(mockNavigate).toHaveBeenCalledWith('DocumentPreview', {
        filePath: '/docs/readme.txt',
        fileName: 'readme.txt',
        fileSize: 500,
      });
    });
  });

  describe('file size formatting', () => {
    it('formats KB size', async () => {
      const kbDoc: any[] = [{ id: 3, name: 'small.txt', path: '/docs/small.txt', size: 2048, enabled: 1, projectId: 'proj1', createdAt: '' }];
      mockGetDocumentsByProject.mockResolvedValue(kbDoc);
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      expect(getByText('2.0 KB')).toBeTruthy();
    });
  });

  describe('back navigation', () => {
    it('calls goBack when back button pressed', async () => {
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      fireEvent.press(getByText('arrow-left'));
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  describe('add document flow', () => {
    it('calls pick when add button pressed', async () => {
      const { pick } = require('@react-native-documents/picker');
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      fireEvent.press(getByText('plus'));
      await flushPromises();
      expect(pick).toHaveBeenCalled();
    });

    it('calls indexDocument after picking a file', async () => {
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      fireEvent.press(getByText('plus'));
      await flushPromises();
      expect(mockIndexDocument).toHaveBeenCalled();
    });

    it('reloads docs after indexing', async () => {
      const { getByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      const initialCallCount = mockGetDocumentsByProject.mock.calls.length;
      fireEvent.press(getByText('plus'));
      await flushPromises();
      expect(mockGetDocumentsByProject.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  describe('error handling', () => {
    it('handles load error gracefully', async () => {
      mockGetDocumentsByProject.mockRejectedValueOnce(new Error('DB error'));
      const { Alert } = require('react-native');
      jest.spyOn(Alert, 'alert').mockImplementation((..._args: unknown[]) => undefined);
      render(<KnowledgeBaseScreen />);
      await flushPromises();
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'DB error');
    });
  });

  describe('toggle document', () => {
    it('calls toggleDocument when switch is toggled', async () => {
      const toggleDoc: any[] = [{ id: 1, name: 'file.txt', path: '/file.txt', size: 100, enabled: 1, projectId: 'proj1', createdAt: '' }];
      mockGetDocumentsByProject.mockResolvedValue(toggleDoc);
      const { UNSAFE_getAllByType } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      const { Switch } = require('react-native');
      const switches = UNSAFE_getAllByType(Switch);
      fireEvent(switches[0], 'valueChange', false);
      await flushPromises();
      expect(mockToggleDocument).toHaveBeenCalledWith(1, false);
    });
  });

  describe('delete document', () => {
    it('shows Alert when delete is pressed and calls deleteDocument on confirm', async () => {
      const deleteDoc: any[] = [{ id: 1, name: 'file.txt', path: '/file.txt', size: 100, enabled: 1, projectId: 'proj1', createdAt: '' }];
      mockGetDocumentsByProject.mockResolvedValue(deleteDoc);
      const { Alert } = require('react-native');
      let confirmCallback: (() => void) | undefined;
      jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
        const buttons = args[2] as any[];
        const removeBtn = buttons?.find((b: any) => b.style === 'destructive');
        confirmCallback = removeBtn?.onPress;
      });

      const { getAllByText } = render(<KnowledgeBaseScreen />);
      await flushPromises();
      fireEvent.press(getAllByText('trash-2')[0]);
      expect(Alert.alert).toHaveBeenCalledWith('Remove Document', expect.stringContaining('file.txt'), expect.any(Array));

      await act(async () => {
        confirmCallback?.();
        await flushPromises();
      });
      expect(mockDeleteDocument).toHaveBeenCalledWith(1);
    });
  });
});
