import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { COLORS } from '../constants';
import { triggerHaptic } from '../utils/haptics';
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
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
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

// Animated tab icon with scale spring on focus
const TAB_ICON_MAP: Record<string, string> = {
  HomeTab: 'home',
  ChatsTab: 'message-circle',
  ProjectsTab: 'folder',
  ModelsTab: 'cpu',
  SettingsTab: 'settings',
};

const TabBarIcon: React.FC<{ name: string; focused: boolean }> = ({ name, focused }) => {
  const scale = useSharedValue(focused ? 1.1 : 1);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.1 : 1, { damping: 15, stiffness: 150 });
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.tabIconContainer}>
      <Animated.View style={animatedStyle}>
        <Icon
          name={TAB_ICON_MAP[name] || 'circle'}
          size={22}
          color={focused ? COLORS.primary : COLORS.textMuted}
        />
      </Animated.View>
      {focused && <View style={styles.tabIndicator} />}
    </View>
  );
};

// Main Tab Navigator
const MainTabs: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        animation: 'fade',
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
        options={{ tabBarLabel: 'Home', tabBarButtonTestID: 'home-tab' }}
        listeners={() => ({
          tabPress: () => { triggerHaptic('selectionClick'); },
        })}
      />
      <Tab.Screen
        name="ChatsTab"
        component={ChatsStackNavigator}
        options={{ tabBarLabel: 'Chats', tabBarButtonTestID: 'chats-tab' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            triggerHaptic('selectionClick');
            e.preventDefault();
            navigation.navigate('ChatsTab', { screen: 'ChatsList' });
          },
        })}
      />
      <Tab.Screen
        name="ProjectsTab"
        component={ProjectsStackNavigator}
        options={{ tabBarLabel: 'Projects', tabBarButtonTestID: 'projects-tab' }}
        listeners={() => ({
          tabPress: () => { triggerHaptic('selectionClick'); },
        })}
      />
      <Tab.Screen
        name="ModelsTab"
        component={ModelsStackNavigator}
        options={{ tabBarLabel: 'Models', tabBarButtonTestID: 'models-tab' }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            triggerHaptic('selectionClick');
            navigation.navigate('ModelsTab', { screen: 'ModelsList' });
          },
        })}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStackNavigator}
        options={{ tabBarLabel: 'Settings', tabBarButtonTestID: 'settings-tab' }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            triggerHaptic('selectionClick');
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
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <RootStack.Screen
        name="Gallery"
        component={GalleryScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
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
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIndicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
    marginTop: 3,
  },
});
