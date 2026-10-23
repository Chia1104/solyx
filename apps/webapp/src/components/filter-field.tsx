import { SearchField } from "@heroui/react";

/** A search field that narrows a list on the page as the user types. */
export function FilterField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <SearchField
      aria-label={label}
      value={value}
      onChange={onChange}
      className={className}>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input placeholder={label} />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  );
}
