import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card } from '../components';
import { COLORS } from '../constants';
import { authService } from '../services/authService';
import { useAuthStore } from '../stores/authStore';

interface PassphraseSetupScreenProps {
  isChanging?: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

export const PassphraseSetupScreen: React.FC<PassphraseSetupScreenProps> = ({
  isChanging = false,
  onComplete,
  onCancel,
}) => {
  const [currentPassphrase, setCurrentPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { setEnabled } = useAuthStore();

  const validatePassphrase = (passphrase: string): string | null => {
    if (passphrase.length < 6) {
      return 'Passphrase must be at least 6 characters';
    }
    if (passphrase.length > 50) {
      return 'Passphrase must be 50 characters or less';
    }
    return null;
  };

  const handleSubmit = async () => {
    // Validate new passphrase
    const error = validatePassphrase(newPassphrase);
    if (error) {
      Alert.alert('Invalid Passphrase', error);
      return;
    }

    // Check confirmation matches
    if (newPassphrase !== confirmPassphrase) {
      Alert.alert('Mismatch', 'Passphrases do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      if (isChanging) {
        // Verify current passphrase and change
        const success = await authService.changePassphrase(currentPassphrase, newPassphrase);
        if (!success) {
          Alert.alert('Error', 'Current passphrase is incorrect');
          setIsSubmitting(false);
          return;
        }
        Alert.alert('Success', 'Passphrase changed successfully');
      } else {
        // Set new passphrase
        const success = await authService.setPassphrase(newPassphrase);
        if (!success) {
          Alert.alert('Error', 'Failed to set passphrase');
          setIsSubmitting(false);
          return;
        }
        setEnabled(true);
        Alert.alert('Success', 'Passphrase lock enabled');
      }

      onComplete();
    } catch (error) {
      Alert.alert('Error', 'An error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancelButton}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {isChanging ? 'Change Passphrase' : 'Set Up Passphrase'}
          </Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>🔐</Text>
          </View>

          <Text style={styles.description}>
            {isChanging
              ? 'Enter your current passphrase and then set a new one.'
              : 'Create a passphrase to lock the app. You will need to enter it each time you open the app.'}
          </Text>

          <Card style={styles.inputCard}>
            {isChanging && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Current Passphrase</Text>
                <TextInput
                  style={styles.input}
                  value={currentPassphrase}
                  onChangeText={setCurrentPassphrase}
                  placeholder="Enter current passphrase"
                  placeholderTextColor={COLORS.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                {isChanging ? 'New Passphrase' : 'Passphrase'}
              </Text>
              <TextInput
                style={styles.input}
                value={newPassphrase}
                onChangeText={setNewPassphrase}
                placeholder="Enter passphrase (min 6 characters)"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirm Passphrase</Text>
              <TextInput
                style={styles.input}
                value={confirmPassphrase}
                onChangeText={setConfirmPassphrase}
                placeholder="Re-enter passphrase"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </Card>

          <View style={styles.tips}>
            <Text style={styles.tipsTitle}>Tips for a good passphrase:</Text>
            <Text style={styles.tipItem}>• Use a mix of words and numbers</Text>
            <Text style={styles.tipItem}>• Make it memorable but not obvious</Text>
            <Text style={styles.tipItem}>• Avoid personal information</Text>
          </View>

          <Button
            title={isSubmitting ? 'Saving...' : (isChanging ? 'Change Passphrase' : 'Enable Lock')}
            onPress={handleSubmit}
            disabled={isSubmitting}
            style={styles.submitButton}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  cancelButton: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  iconContainer: {
    alignItems: 'center',
    marginVertical: 24,
  },
  icon: {
    fontSize: 64,
  },
  description: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  inputCard: {
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: 14,
    color: COLORS.text,
    fontSize: 16,
  },
  tips: {
    marginBottom: 24,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  tipItem: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 22,
  },
  submitButton: {
    marginBottom: 32,
  },
});
