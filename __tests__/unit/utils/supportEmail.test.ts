import { Alert, Linking } from 'react-native';
import {
  openSupportEmail,
  SUPPORT_EMAIL,
} from '../../../src/utils/supportEmail';

describe('supportEmail', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the shared address when the device cannot open mail', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    const alert = jest.spyOn(Alert, 'alert');

    await openSupportEmail({ subject: 'Subject', body: 'Body' });

    expect(alert).toHaveBeenCalledWith(
      'Could Not Open Mail',
      `Email us at ${SUPPORT_EMAIL}.`,
      [{ text: 'OK' }],
    );
  });
});
