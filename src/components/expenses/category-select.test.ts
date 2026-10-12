import { beforeEach, expect, test, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({
  presets: ['Essen', 'Getränke', 'Unterkunft', 'Transport', 'Aktivitäten', 'Einkauf', 'Sonstiges'],
}));
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, { raw: () => mocks.presets }),
}));
import { CategorySelect } from './category-select';
beforeEach(() => vi.stubGlobal('React', React));

test('legacy Food selects canonical food and displays Essen in German', () => {
  const html = renderToStaticMarkup(React.createElement(CategorySelect, { value: 'Food', onChange: vi.fn() }));
  expect(html).toContain('value="food" selected=""');
  expect(html).toContain('Essen');
  expect(html).not.toContain('value="Essen"');
  expect(html).not.toContain('value="Food"');
  expect(html).not.toContain('<input');
});

test('a language switch keeps the same selected ID', () => {
  mocks.presets = ['Food', 'Drinks', 'Accommodation', 'Transport', 'Activities', 'Shopping', 'Other'];
  const html = renderToStaticMarkup(React.createElement(CategorySelect, { value: 'Essen', onChange: vi.fn() }));
  expect(html).toContain('value="food" selected=""');
  expect(html).toContain('Food');
  expect(html).not.toContain('<input');
});

test('custom categories stay editable as entered', () => {
  const html = renderToStaticMarkup(React.createElement(CategorySelect, { value: 'Tauchen', onChange: vi.fn() }));
  expect(html).toContain('value="__custom__" selected=""');
  expect(html).toContain('value="Tauchen"');
});
