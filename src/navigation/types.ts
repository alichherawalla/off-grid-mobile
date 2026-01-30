export type RootStackParamList = {
  Onboarding: undefined;
  ModelDownload: undefined;
  Main: undefined;
};

// Tab navigator params
export type MainTabParamList = {
  HomeTab: undefined;
  ChatsTab: undefined;
  ProjectsTab: undefined;
  ModelsTab: undefined;
  SettingsTab: undefined;
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
  Models: undefined;
  ModelDownloadDetail: { modelId: string };
};

export type SettingsStackParamList = {
  SettingsMain: undefined;
  PassphraseSetup: undefined;
  ChangePassphrase: undefined;
};
