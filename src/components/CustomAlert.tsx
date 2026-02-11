import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { AppSheet } from './AppSheet';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface CustomAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  onClose?: () => void;
  loading?: boolean;
}

export const CustomAlert: React.FC<CustomAlertProps> = ({
  visible,
  title,
  message,
  buttons = [{ text: 'OK', style: 'default' }],
  onClose,
  loading = false,
}) => {
  const handleButtonPress = (button: AlertButton) => {
    button.onPress?.();
    onClose?.();
  };

  return (
    <AppSheet
      visible={visible}
      onClose={() => onClose?.()}
      enableDynamicSizing
      title={title}
      closeLabel="Done"
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={COLORS.primary} style={styles.loadingIndicator} />
        ) : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.buttonContainer}>
          {buttons.map((button, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.button,
                button.style === 'destructive' && styles.destructiveButton,
              ]}
              onPress={() => handleButtonPress(button)}
            >
              <Text
                style={[
                  styles.buttonText,
                  button.style === 'cancel' && styles.cancelButtonText,
                  button.style === 'destructive' && styles.destructiveButtonText,
                ]}
              >
                {button.text}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </AppSheet>
  );
};

// Hook for managing alert state
export interface AlertState {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  loading?: boolean;
}

export const initialAlertState: AlertState = {
  visible: false,
  title: '',
  message: undefined,
  buttons: undefined,
  loading: false,
};

// Helper function to show alert (returns state to set)
export const showAlert = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  loading?: boolean
): AlertState => ({
  visible: true,
  title,
  message,
  buttons,
  loading,
});

// Helper function to hide alert (returns state to set)
export const hideAlert = (): AlertState => initialAlertState;

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    alignItems: 'center',
  },
  loadingIndicator: {
    marginBottom: SPACING.md,
  },
  message: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  buttonContainer: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
    width: '100%',
    gap: SPACING.sm,
  },
  button: {
    flex: 1,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  buttonText: {
    ...TYPOGRAPHY.body,
    color: COLORS.primary,
  },
  cancelButtonText: {
    color: COLORS.textMuted,
  },
  destructiveButton: {
    borderColor: COLORS.error,
  },
  destructiveButtonText: {
    color: COLORS.error,
  },
});
