import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { SelectField } from './SelectField.js';

const OPTIONS = [
  { value: '', label: 'No price' },
  { value: 'THB', label: 'THB' },
];

describe('SelectField', () => {
  it('renders the options in order with a visible label', () => {
    render(<SelectField label="Currency" options={OPTIONS} />);
    const select = screen.getByLabelText('Currency') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'No price',
      'THB',
    ]);
  });

  it('marks the select invalid and describes the error', () => {
    render(<SelectField label="Currency" options={OPTIONS} error="Choose a currency." />);
    const select = screen.getByLabelText('Currency');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Choose a currency.');
  });

  it('forwards the ref', () => {
    const ref = createRef<HTMLSelectElement>();
    render(<SelectField ref={ref} label="Currency" options={OPTIONS} />);
    expect(ref.current).toBe(screen.getByLabelText('Currency'));
  });
});
