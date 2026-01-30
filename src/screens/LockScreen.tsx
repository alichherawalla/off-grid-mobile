import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components';
import { COLORS } from '../constants';
import { authService } from '../services/authService';
import { useAuthStore } from '../stores/authStore';

interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [passphrase, setPassphrase] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  const {
    failedAttempts,
    recordFailedAttempt,
    resetFailedAttempts,
    checkLockout,
    getLockoutRemaining,
  } = useAuthStore();

  // Check and update lockout timer
  useEffect(() => {
    const updateLockout = () => {
      if (checkLockout()) {
        setLockoutSeconds(getLockoutRemaining());
      } else {
        setLockoutSeconds(0);
      }
    };

    updateLockout();
    const interval = setInterval(updateLockout, 1000);
    return () => clearInterval(interval);
  }, [checkLockout, getLockoutRemaining]);

  const handleUnlock = useCallback(async () => {
    if (!passphrase.trim()) {
      Alert.alert('Error', 'Please enter your passphrase');
      return;
    }

    if (checkLockout()) {
      return;
    }

    setIsVerifying(true);

    try {
      const isValid = await authService.verifyPassphrase(passphrase);

      if (isValid) {
        resetFailedAttempts();
        setPassphrase('');
        onUnlock();
      } else {
        const isLockedOut = recordFailedAttempt();
        setPassphrase('');

        if (isLockedOut) {
          Alert.alert(
            'Too Many Attempts',
            'You have been locked out for 5 minutes due to too many failed attempts.'
          );
        } else {
          const remaining = 5 - (failedAttempts + 1);
          Alert.alert(
            'Incorrect Passphrase',
            remaining > 0
              ? `${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout.`
              : 'Incorrect passphrase.'
          );
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to verify passphrase');
    } finally {
      setIsVerifying(false);
    }
  }, [passphrase, checkLockout, failedAttempts, recordFailedAttempt, resetFailedAttempts, onUnlock]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isLockedOut = lockoutSeconds > 0;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.content}
      >
        <View style={styles.header}>
          <Text style={styles.lockIcon}>🔒</Text>
          <Text style={styles.title}>App Locked</Text>
          <Text style={styles.subtitle}>
            Enter your passphrase to unlock
          </Text>
        </View>

        {isLockedOut ? (
          <View style={styles.lockoutContainer}>
            <Text style={styles.lockoutText}>Too many failed attempts</Text>
            <Text style={styles.lockoutTimer}>{formatTime(lockoutSeconds)}</Text>
            <Text style={styles.lockoutHint}>Please wait before trying again</Text>
          </View>
        ) : (
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={passphrase}
              onChangeText={setPassphrase}
              placeholder="Enter passphrase"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleUnlock}
            />

            <Button
              title={isVerifying ? 'Verifying...' : 'Unlock'}
              onPress={handleUnlock}
              disabled={isVerifying || !passphrase.trim()}
              style={styles.unlockButton}
            />

            {failedAttempts > 0 && (
              <Text style={styles.attemptsText}>
                {5 - failedAttempts} attempt{5 - failedAttempts === 1 ? '' : 's'} remaining
              </Text>
            )}
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerIcon}>🛡️</Text>
          <Text style={styles.footerText}>
            Your data is protected and stored locally
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  lockIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 40,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    color: COLORS.text,
    fontSize: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  unlockButton: {
    marginTop: 8,
  },
  attemptsText: {
    textAlign: 'center',
    color: COLORS.warning,
    fontSize: 14,
    marginTop: 12,
  },
  lockoutContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  lockoutText: {
    fontSize: 16,
    color: COLORS.error,
    marginBottom: 12,
  },
  lockoutTimer: {
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  lockoutHint: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  footer: {
    alignItems: 'center',
    opacity: 0.7,
  },
  footerIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  footerText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
