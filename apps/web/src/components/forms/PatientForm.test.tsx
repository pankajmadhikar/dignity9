import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PatientForm } from './PatientForm';

describe('PatientForm', () => {
  it('asks for a patient name before creating a record', async () => {
    render(<PatientForm onSaved={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create patient' }));
    expect(await screen.findByText('Enter the patient name')).toBeTruthy();
  });
});
