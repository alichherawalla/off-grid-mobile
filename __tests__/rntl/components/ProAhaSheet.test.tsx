import React from 'react';
import { render } from '@testing-library/react-native';
import { ProAhaSheet } from '../../../src/components/ProAhaSheet';

describe('ProAhaSheet remote media value', () => {
  it('shows the work a named Desktop can do for this phone', () => {
    const ui = render(
      <ProAhaSheet visible onClose={() => undefined} onRegister={() => undefined} />,
    );

    expect(ui.getByText('Create images with the model active on your Desktop')).toBeTruthy();
    expect(ui.getByText('Transcribe speech with the model active on your Desktop')).toBeTruthy();
    expect(ui.getByText('Hear replies in the voice active on your Desktop')).toBeTruthy();
    expect(ui.getByText('Control which models your named Desktop serves')).toBeTruthy();
  });
});
