/** Narrows a key to one of a const enum object's values. */
export const isEnumValue = <const TEnum extends Record<string, string>>(
  enumObject: TEnum,
  value: PropertyKey
): value is TEnum[keyof TEnum] =>
  Object.values(enumObject).some((member) => member === value);
