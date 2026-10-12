import { expect, test } from 'vitest';
import { CATEGORY_KEYS, categoryLabel, categoryIcon, normalizeCategory, nearbyFilters } from './categories';

const de = ['Essen', 'Getränke', 'Unterkunft', 'Transport', 'Aktivitäten', 'Einkauf', 'Sonstiges'];
const en = ['Food', 'Drinks', 'Accommodation', 'Transport', 'Activities', 'Shopping', 'Other'];

for (const [index, key] of CATEGORY_KEYS.entries()) {
  test(`${key}: German and English presets share one stable ID`, () => {
    expect(normalizeCategory(de[index]!)).toBe(key);
    expect(normalizeCategory(en[index]!)).toBe(key);
    expect(normalizeCategory(` ${en[index]!.toUpperCase()} `)).toBe(key);
    expect(categoryLabel(key, de)).toBe(de[index]);
    expect(categoryLabel(de[index]!, en)).toBe(en[index]);
    expect(normalizeCategory(normalizeCategory(de[index]!))).toBe(key);
  });
}

for (const custom of ['Tauchen', 'My Food Budget', 'constructor', '__proto__', 'toString', '']) {
  test(`preserves custom category ${custom}`, () => {
    expect(normalizeCategory(custom)).toBe(custom);
    expect(categoryLabel(custom, de)).toBe(custom);
  });
}

test('canonical and legacy labels keep the same icon and nearby filters', () => {
  expect(categoryIcon('food')).toBe(categoryIcon('Essen'));
  expect(nearbyFilters('Essen')).toEqual(nearbyFilters('food'));
});
