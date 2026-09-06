import { Alert, Linking } from 'react-native';

export const SUPPORT_EMAIL = 'support@getoffgridai.co';

interface SupportEmailDraft {
  subject: string;
  body: string;
}

export async function openSupportEmail({
  subject,
  body,
}: SupportEmailDraft): Promise<void> {
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could Not Open Mail', `Email us at ${SUPPORT_EMAIL}.`, [
      { text: 'OK' },
    ]);
  }
}
