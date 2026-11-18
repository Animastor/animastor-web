import { describe, it, expect } from 'vitest';
import { ENTITY_SCHEMAS } from '../src/entityEditor';
import * as pkg from '../src/index';

describe('entityEditor', () => {
  describe('ENTITY_SCHEMAS', () => {
    it('VBook 4 (0.3.0): locations only — characters, voices and behaviours are heroes', () => {
      expect(Object.keys(ENTITY_SCHEMAS)).toEqual(['location']);
    });

    it('location schema has 7 extra fields', () => {
      expect(ENTITY_SCHEMAS.location.fields).toHaveLength(7);
    });

    it('all schema kinds match their key', () => {
      for (const [key, schema] of Object.entries(ENTITY_SCHEMAS)) {
        expect(schema.kind).toBe(key);
      }
    });

    it('the 3.1 behaviour dialog is gone from the package surface', () => {
      expect('BehaviorAddDialog' in pkg).toBe(false);
    });
  });
});
