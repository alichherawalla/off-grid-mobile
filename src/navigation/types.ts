import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Onboarding: undefined;
  ModelDownload: undefined;
  Main: undefined;
  DownloadManager: undefined;
  Gallery: { conversationId?: string } | undefined;
};

// Tab navigator params
export type MainTabParamList = {
  HomeTab: undefined;
  ChatsTab: NavigatorScreenParams<ChatsStackParamList> | undefined;
  ProjectsTab: NavigatorScreenParams<ProjectsStackParamList> | undefined;
  ModelsTab: NavigatorScreenParams<ModelsStackParamList> | undefined;
  SettingsTab: NavigatorScreenParams<SettingsStackParamList> | undefined;
};

// Stack navigators within tabs
export type HomeStackParamList = {
  Home: undefined;
};

export type ChatsStackParamList = {
  ChatsList: undefined;
  Chat: { conversationId?: string; projectId?: string };
};

export type ProjectsStackParamList = {
  ProjectsList: undefined;
  ProjectDetail: { projectId: string };
  ProjectEdit: { projectId?: string }; // undefined = new project
  ProjectChats: { projectId: string };
};

export type ModelsStackParamList = {
  ModelsList: undefined;
  ModelDetail: { modelId: string };
};

export type SettingsStackParamList = {
  SettingsMain: undefined;
  ModelSettings: undefined;
  VoiceSettings: undefined;
  DeviceInfo: undefined;
  StorageSettings: undefined;
  SecuritySettings: undefined;
  PassphraseSetup: undefined;
  ChangePassphrase: undefined;
};
