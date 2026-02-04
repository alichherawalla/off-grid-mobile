import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { COLORS } from '../constants';

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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.alertContainer}>
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.primary} style={styles.loadingIndicator} />
          ) : null}
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.buttonContainer}>
            {buttons.map((button, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.button,
                  buttons.length > 1 && index < buttons.length - 1 && styles.buttonBorder,
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
      </View>
    </Modal>
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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 40,
    maxWidth: 320,
    minWidth: 280,
    alignItems: 'center',
  },
  loadingIndicator: {
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    marginTop: 8,
    width: '100%',
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBorder: {
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.primary,
  },
  cancelButtonText: {
    color: COLORS.textMuted,
  },
  destructiveButton: {},
  destructiveButtonText: {
    color: COLORS.error,
  },
});
