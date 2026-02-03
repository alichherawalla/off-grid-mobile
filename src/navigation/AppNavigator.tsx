import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { COLORS } from '../constants';
import { useAppStore } from '../stores';
import {
  OnboardingScreen,
  ModelDownloadScreen,
  HomeScreen,
  ModelsScreen,
  ChatScreen,
  SettingsScreen,
  ProjectsScreen,
  ChatsListScreen,
  ProjectDetailScreen,
  ProjectEditScreen,
  DownloadManagerScreen,
  ModelSettingsScreen,
  VoiceSettingsScreen,
  DeviceInfoScreen,
  StorageSettingsScreen,
  SecuritySettingsScreen,
  GalleryScreen,
} from '../screens';
import {
  RootStackParamList,
  MainTabParamList,
  ChatsStackParamList,
  ProjectsStackParamList,
  ModelsStackParamList,
  SettingsStackParamList,
} from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const ChatsStack = createNativeStackNavigator<ChatsStackParamList>();
const ProjectsStack = createNativeStackNavigator<ProjectsStackParamList>();
const ModelsStack = createNativeStackNavigator<ModelsStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

// Chats Tab Stack
const ChatsStackNavigator: React.FC = () => {
  return (
    <ChatsStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    >
      <ChatsStack.Screen name="ChatsList" component={ChatsListScreen} />
      <ChatsStack.Screen name="Chat" component={ChatScreen} />
    </ChatsStack.Navigator>
  );
};

// Projects Tab Stack
const ProjectsStackNavigator: React.FC = () => {
  return (
    <ProjectsStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    >
      <ProjectsStack.Screen name="ProjectsList" component={ProjectsScreen} />
      <ProjectsStack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
      <ProjectsStack.Screen
        name="ProjectEdit"
        component={ProjectEditScreen}
        options={{ presentation: 'modal' }}
      />
    </ProjectsStack.Navigator>
  );
};

// Models Tab Stack
const ModelsStackNavigator: React.FC = () => {
  return (
    <ModelsStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    >
      <ModelsStack.Screen name="ModelsList" component={ModelsScreen} />
    </ModelsStack.Navigator>
  );
};

// Settings Tab Stack
const SettingsStackNavigator: React.FC = () => {
  return (
    <SettingsStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    >
      <SettingsStack.Screen name="SettingsMain" component={SettingsScreen} />
      <SettingsStack.Screen name="ModelSettings" component={ModelSettingsScreen} />
      <SettingsStack.Screen name="VoiceSettings" component={VoiceSettingsScreen} />
      <SettingsStack.Screen name="DeviceInfo" component={DeviceInfoScreen} />
      <SettingsStack.Screen name="StorageSettings" component={StorageSettingsScreen} />
      <SettingsStack.Screen name="SecuritySettings" component={SecuritySettingsScreen} />
    </SettingsStack.Navigator>
  );
};

// Tab icon component
const TabBarIcon: React.FC<{ name: string; focused: boolean }> = ({ name, focused }) => {
  const iconMap: Record<string, string> = {
    HomeTab: 'home',
    ChatsTab: 'message-circle',
    ProjectsTab: 'folder',
    ModelsTab: 'cpu',
    SettingsTab: 'settings',
  };

  return (
    <Icon
      name={iconMap[name] || 'circle'}
      size={22}
      color={focused ? COLORS.primary : COLORS.textMuted}
    />
  );
};

// Main Tab Navigator
const MainTabs: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarIcon: ({ focused }) => (
          <TabBarIcon name={route.name} focused={focused} />
        ),
        tabBarLabelStyle: styles.tabLabel,
      })}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tab.Screen
        name="ChatsTab"
        component={ChatsStackNavigator}
        options={{ tabBarLabel: 'Chats' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            // Reset to ChatsList when tab is pressed
            navigation.navigate('ChatsTab', { screen: 'ChatsList' });
          },
        })}
      />
      <Tab.Screen
        name="ProjectsTab"
        component={ProjectsStackNavigator}
        options={{ tabBarLabel: 'Projects' }}
      />
      <Tab.Screen
        name="ModelsTab"
        component={ModelsStackNavigator}
        options={{ tabBarLabel: 'Models' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            // Reset to ModelsList when tab is pressed
            navigation.navigate('ModelsTab', { screen: 'ModelsList' });
          },
        })}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStackNavigator}
        options={{ tabBarLabel: 'Settings' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            // Reset to SettingsMain when tab is pressed
            navigation.navigate('SettingsTab', { screen: 'SettingsMain' });
          },
        })}
      />
    </Tab.Navigator>
  );
};

// Root Navigator
export const AppNavigator: React.FC = () => {
  const hasCompletedOnboarding = useAppStore((s) => s.hasCompletedOnboarding);
  const downloadedModels = useAppStore((s) => s.downloadedModels);

  // Determine initial route
  let initialRoute: keyof RootStackParamList = 'Onboarding';
  if (hasCompletedOnboarding) {
    initialRoute = downloadedModels.length > 0 ? 'Main' : 'ModelDownload';
  }

  return (
    <RootStack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
        animation: 'slide_from_right',
      }}
    >
      <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
      <RootStack.Screen name="ModelDownload" component={ModelDownloadScreen} />
      <RootStack.Screen name="Main" component={MainTabs} />
      <RootStack.Screen
        name="DownloadManager"
        component={DownloadManagerScreen}
        options={{ presentation: 'modal' }}
      />
      <RootStack.Screen
        name="Gallery"
        component={GalleryScreen}
        options={{ presentation: 'modal' }}
      />
    </RootStack.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.surface,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    height: 80,
    paddingBottom: 20,
    paddingTop: 10,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});
