import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE } from '../../src/contracts/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('G4 structural extractor profile', () => {
  it('keeps the executable language boundary equal to its schema-admitted fixture', () => {
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(root, 'schemas/structural-extractor-profile.v0.1.0-candidate.schema.json'),
        'utf8'
      )
    );
    const fixture = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/g4/structural-extractor-profile.json'), 'utf8')
    );
    const validate = new Ajv2020({
      allErrors: true,
      strict: true,
      strictRequired: false,
      validateFormats: false,
    }).compile(schema);

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(fixture).toEqual(GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE);
    expect(
      fixture.languages.find((entry: { language: string }) => entry.language === 'rust')
    ).toMatchObject({ extractions: ['static-imports'] });
  });
});
