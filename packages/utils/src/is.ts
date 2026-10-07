/** Narrows a key to one of a const enum object's values. */
export const isEnumValue = <const TEnum extends Record<string, string>>(
  enumObject: TEnum,
  value: PropertyKey
): value is TEnum[keyof TEnum] =>
  Object.values(enumObject).some((member) => member === value);

/** Whether `value` names a time zone this runtime knows, such as `Asia/Taipei` or `UTC`. */
export function isTimeZone(value: string): boolean {
  if (value === "") return false;

  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions()
        .timeZone !== undefined
    );
  } catch {
    return false;
  }
}
