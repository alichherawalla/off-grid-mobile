import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SelectDropdown } from '../../../src/components/SelectDropdown';

describe('SelectDropdown', () => {
  it('closes when the user presses outside the open menu', () => {
    const onChange = jest.fn();
    const ui = render(
      <SelectDropdown
        value="all"
        options={[
          { value: 'all', label: 'All' },
          { value: 'done', label: 'Done' },
        ]}
        onChange={onChange}
        accessibilityLabel="Filter"
        testID="filter"
      />,
    );

    fireEvent.press(ui.getByTestId('filter'));
    expect(ui.getByTestId('filter-option-done')).toBeTruthy();

    fireEvent.press(ui.getByTestId('filter-backdrop'));

    expect(ui.queryByTestId('filter-option-done')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
