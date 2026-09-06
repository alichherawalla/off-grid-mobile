/**
 * ProjectEditScreen — real composition.
 *
 * Mounts the REAL screen over the REAL project store. No mock of Off Grid code:
 * the only fakes are navigation (device boundary) and safe-area/vector-icons
 * (native modules). Every assertion reads the UI the user sees, or the project
 * state the user's save produced.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { useProjectStore } from '../../../src/stores/projectStore';
import { resetStores } from '../../utils/testHelpers';
import { createProject } from '../../utils/factories';

const mockGoBack = jest.fn();
let mockRouteParams: any = {};

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({ params: mockRouteParams }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

import { ProjectEditScreen } from '../../../src/screens/ProjectEditScreen';

const EXISTING = createProject({
  id: 'proj1',
  name: 'Test Project',
  description: 'Test desc',
  systemPrompt: 'Be helpful',
});

const arriveOnExistingProject = () => {
  mockRouteParams = { projectId: EXISTING.id };
  useProjectStore.setState({ projects: [EXISTING] });
  return render(<ProjectEditScreen />);
};

const arriveOnNewProject = () => {
  mockRouteParams = {};
  useProjectStore.setState({ projects: [] });
  return render(<ProjectEditScreen />);
};

const storedProject = (id: string) =>
  useProjectStore.getState().projects.find(p => p.id === id);

describe('ProjectEditScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStores();
  });

  describe('edit mode rendering', () => {
    it('renders edit screen title', () => {
      const { getByText } = arriveOnExistingProject();
      expect(getByText('Edit Project')).toBeTruthy();
    });

    it('shows the project name and description already saved', () => {
      const { getByDisplayValue } = arriveOnExistingProject();
      expect(getByDisplayValue('Test Project')).toBeTruthy();
      expect(getByDisplayValue('Test desc')).toBeTruthy();
    });

    it('shows the saved system prompt', () => {
      const { getByDisplayValue } = arriveOnExistingProject();
      expect(getByDisplayValue('Be helpful')).toBeTruthy();
    });

    it('shows labels for all fields', () => {
      const { getByText } = arriveOnExistingProject();
      expect(getByText('Name *')).toBeTruthy();
      expect(getByText('Description')).toBeTruthy();
      expect(getByText('System Prompt *')).toBeTruthy();
    });

    it('shows hint text for system prompt', () => {
      const { getByText } = arriveOnExistingProject();
      expect(
        getByText(/This context is sent to the AI at the start of every chat/),
      ).toBeTruthy();
    });

    it('shows tip text', () => {
      const { getByText } = arriveOnExistingProject();
      expect(
        getByText(/Tip: Be specific about what you want the AI to do/),
      ).toBeTruthy();
    });

    it('shows Cancel and Save buttons in header', () => {
      const { getByText } = arriveOnExistingProject();
      expect(getByText('Cancel')).toBeTruthy();
      expect(getByText('Save')).toBeTruthy();
    });
  });

  describe('new project mode rendering', () => {
    it('renders "New Project" title when no projectId', () => {
      const { getByText } = arriveOnNewProject();
      expect(getByText('New Project')).toBeTruthy();
    });

    it('shows empty inputs when creating new project', () => {
      const { getByTestId } = arriveOnNewProject();
      expect(getByTestId('project-edit-name').props.value).toBe('');
      expect(getByTestId('project-edit-description').props.value).toBe('');
      expect(getByTestId('project-edit-system-prompt').props.value).toBe('');
    });
  });

  describe('form editing', () => {
    it('updates name field on text change', () => {
      const { getByDisplayValue } = arriveOnExistingProject();
      fireEvent.changeText(getByDisplayValue('Test Project'), 'Updated Name');
      expect(getByDisplayValue('Updated Name')).toBeTruthy();
    });

    it('updates description field on text change', () => {
      const { getByDisplayValue } = arriveOnExistingProject();
      fireEvent.changeText(getByDisplayValue('Test desc'), 'Updated Description');
      expect(getByDisplayValue('Updated Description')).toBeTruthy();
    });

    it('updates system prompt field on text change', () => {
      const { getByDisplayValue } = arriveOnExistingProject();
      fireEvent.changeText(getByDisplayValue('Be helpful'), 'New system prompt');
      expect(getByDisplayValue('New system prompt')).toBeTruthy();
    });
  });

  describe('save handler', () => {
    it('saves the edited project and leaves the screen', () => {
      const { getByDisplayValue, getByText } = arriveOnExistingProject();
      fireEvent.changeText(getByDisplayValue('Test Project'), 'Renamed Project');
      fireEvent.press(getByText('Save'));

      expect(storedProject('proj1')).toMatchObject({
        name: 'Renamed Project',
        description: 'Test desc',
        systemPrompt: 'Be helpful',
      });
      expect(mockGoBack).toHaveBeenCalled();
    });

    it('creates a new project from the filled form and leaves the screen', () => {
      const { getByTestId, getByText } = arriveOnNewProject();

      fireEvent.changeText(getByTestId('project-edit-name'), 'My New Project');
      fireEvent.changeText(getByTestId('project-edit-description'), 'A description');
      fireEvent.changeText(getByTestId('project-edit-system-prompt'), 'You are helpful');
      fireEvent.press(getByText('Save'));

      const projects = useProjectStore.getState().projects;
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        name: 'My New Project',
        description: 'A description',
        systemPrompt: 'You are helpful',
      });
      expect(mockGoBack).toHaveBeenCalled();
    });

    it('trims whitespace from form data when saving', () => {
      const { getByDisplayValue, getByText } = arriveOnExistingProject();

      fireEvent.changeText(getByDisplayValue('Test Project'), '  Trimmed Name  ');
      fireEvent.changeText(getByDisplayValue('Test desc'), '  Trimmed Desc  ');
      fireEvent.changeText(getByDisplayValue('Be helpful'), '  Trimmed Prompt  ');
      fireEvent.press(getByText('Save'));

      expect(storedProject('proj1')).toMatchObject({
        name: 'Trimmed Name',
        description: 'Trimmed Desc',
        systemPrompt: 'Trimmed Prompt',
      });
    });
  });

  describe('validation', () => {
    it('shows an error and keeps the user on the screen when name is empty', () => {
      const { getByDisplayValue, getByText } = arriveOnExistingProject();
      fireEvent.changeText(getByDisplayValue('Test Project'), '');
      fireEvent.press(getByText('Save'));

      expect(getByText('Please enter a name for the project')).toBeTruthy();
      expect(storedProject('proj1')?.name).toBe('Test Project');
      expect(mockGoBack).not.toHaveBeenCalled();
    });

    it('shows the name error when the name is only whitespace', () => {
      const { getByDisplayValue, getByText } = arriveOnExistingProject();
      fireEvent.changeText(getByDisplayValue('Test Project'), '   ');
      fireEvent.press(getByText('Save'));

      expect(getByText('Please enter a name for the project')).toBeTruthy();
      expect(storedProject('proj1')?.name).toBe('Test Project');
    });

    it('shows an error and keeps the user on the screen when system prompt is empty', () => {
      const { getByDisplayValue, getByText } = arriveOnExistingProject();
      fireEvent.changeText(getByDisplayValue('Be helpful'), '');
      fireEvent.press(getByText('Save'));

      expect(getByText('Please enter a system prompt')).toBeTruthy();
      expect(storedProject('proj1')?.systemPrompt).toBe('Be helpful');
      expect(mockGoBack).not.toHaveBeenCalled();
    });

    it('shows the prompt error when the system prompt is only whitespace', () => {
      const { getByDisplayValue, getByText } = arriveOnExistingProject();
      fireEvent.changeText(getByDisplayValue('Be helpful'), '   ');
      fireEvent.press(getByText('Save'));

      expect(getByText('Please enter a system prompt')).toBeTruthy();
    });

    it('reports the missing name first when both fields are empty', () => {
      const { getByDisplayValue, getByText, queryByText } = arriveOnExistingProject();
      fireEvent.changeText(getByDisplayValue('Test Project'), '');
      fireEvent.changeText(getByDisplayValue('Be helpful'), '');
      fireEvent.press(getByText('Save'));

      expect(getByText('Please enter a name for the project')).toBeTruthy();
      expect(queryByText('Please enter a system prompt')).toBeNull();
    });
  });

  describe('navigation', () => {
    it('leaves the screen when Cancel is pressed', () => {
      const { getByText } = arriveOnExistingProject();
      fireEvent.press(getByText('Cancel'));
      expect(mockGoBack).toHaveBeenCalled();
    });
  });
});
