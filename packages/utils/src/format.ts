// Decimal units, as the OS file managers count sizes.
const BYTE_UNITS = [
  { unit: "gigabyte", bytes: 1e9 },
  { unit: "megabyte", bytes: 1e6 },
  { unit: "kilobyte", bytes: 1e3 },
];

/** A size on disk in the largest unit that keeps it at one or more, as `locale` writes it. */
export function formatBytes(bytes: number, locale: string) {
  const { unit, bytes: size } = BYTE_UNITS.find(
    (candidate) => bytes >= candidate.bytes
  ) ?? { unit: "byte", bytes: 1 };

  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    // The short form of a byte takes no plural in English, so bytes are spelled out.
    unitDisplay: unit === "byte" ? "long" : "short",
    maximumFractionDigits: 1,
  }).format(bytes / size);
}
