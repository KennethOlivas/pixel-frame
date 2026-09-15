import type { KeyboardEvent } from 'react';
import * as Select from '@radix-ui/react-select';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretUpIcon } from '@phosphor-icons/react/dist/csr/CaretUp';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import './dropdown.css';

export interface DropdownProps {
  id?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
  className?: string;
}

const navigationKeys = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Enter', 'Escape', 'Backspace', 'Delete',
]);

function containKeyboardInteraction(event: KeyboardEvent<HTMLElement>) {
  // Keep navigation and typeahead inside the select instead of triggering video shortcuts.
  if (event.key.length === 1 || navigationKeys.has(event.key)) event.stopPropagation();
}

export function Dropdown({ id, label, value, onValueChange, disabled = false, options, className }: DropdownProps) {
  return (
    <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger
        id={id}
        className={`pf-dropdown-trigger${className ? ` ${className}` : ''}`}
        aria-label={label}
        onKeyDown={containKeyboardInteraction}
      >
        <span className="pf-dropdown-value"><Select.Value /></span>
        <Select.Icon className="pf-dropdown-caret">
          <CaretDownIcon size={14} weight="light" aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="pf-dropdown-content"
          position="popper"
          sideOffset={6}
          collisionPadding={10}
          onKeyDown={containKeyboardInteraction}
          onEscapeKeyDown={event => event.stopPropagation()}
        >
          <Select.ScrollUpButton className="pf-dropdown-scroll">
            <CaretUpIcon size={14} weight="light" aria-hidden="true" />
          </Select.ScrollUpButton>
          <Select.Viewport className="pf-dropdown-viewport">
            {options.map(option => (
              <Select.Item className="pf-dropdown-item" key={option.value} value={option.value} textValue={option.label}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="pf-dropdown-check">
                  <CheckIcon size={14} weight="light" aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="pf-dropdown-scroll">
            <CaretDownIcon size={14} weight="light" aria-hidden="true" />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
