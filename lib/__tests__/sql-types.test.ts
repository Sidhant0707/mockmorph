import { describe, expect, it } from 'vitest';
import { classifyColumnType } from '../sql-types';

describe('classifyColumnType', () => {
  it.each([
    ['INT', 'integer'],
    ['integer', 'integer'],
    ['BIGINT', 'integer'],
    ['smallint', 'integer'],
    ['SERIAL', 'integer'],
    ['int(11)', 'integer'],
    ['INT4', 'integer'],
    ['tinyint', 'integer'],
    ['TINYINT(4)', 'integer'],
  ])('%s is an integer', (raw, kind) => {
    expect(classifyColumnType(raw).kind).toBe(kind);
  });

  it('treats MySQL TINYINT(1) as a boolean, and wider TINYINTs as small integers', () => {
    expect(classifyColumnType('TINYINT(1)').kind).toBe('boolean');
    const wide = classifyColumnType('TINYINT(4)');
    expect(wide.kind).toBe('integer');
    expect(wide.maxInt).toBeLessThanOrEqual(127);
  });

  it('keeps every integer inside SMALLINT range', () => {
    expect(classifyColumnType('SMALLINT').maxInt).toBeLessThanOrEqual(32767);
  });

  it('reads precision and scale from DECIMAL / NUMERIC', () => {
    expect(classifyColumnType('DECIMAL(10,2)')).toMatchObject({ kind: 'decimal', precision: 10, scale: 2 });
    expect(classifyColumnType('numeric(8, 3)')).toMatchObject({ kind: 'decimal', precision: 8, scale: 3 });
    expect(classifyColumnType('NUMERIC(5)')).toMatchObject({ kind: 'decimal', precision: 5, scale: 0 });
  });

  it('gives an unconstrained NUMERIC a default scale but no precision limit', () => {
    const info = classifyColumnType('NUMERIC');
    expect(info.kind).toBe('decimal');
    expect(info.precision).toBeUndefined();
    expect(info.scale).toBe(2);
  });

  it.each(['REAL', 'FLOAT', 'FLOAT8', 'double precision', 'DOUBLE'])('%s is a float', (raw) => {
    expect(classifyColumnType(raw).kind).toBe('float');
  });

  it.each([
    ['BOOLEAN', 'boolean'],
    ['bool', 'boolean'],
    ['DATE', 'date'],
    ['TIMESTAMP', 'timestamp'],
    ['timestamptz', 'timestamp'],
    ['TIMESTAMP(3)', 'timestamp'],
    ['timestamp with time zone', 'timestamp'],
    ['TIMESTAMP(3) WITHOUT TIME ZONE', 'timestamp'],
    ['DATETIME', 'timestamp'],
    ['TIME', 'time'],
    ['time with time zone', 'time'],
    ['TIME WITHOUT TIME ZONE', 'time'],
    ['UUID', 'uuid'],
    ['JSON', 'json'],
    ['jsonb', 'json'],
  ])('%s -> %s', (raw, kind) => {
    expect(classifyColumnType(raw).kind).toBe(kind);
  });

  it('does not confuse TIMESTAMP with TIME', () => {
    expect(classifyColumnType('timestamp').kind).toBe('timestamp');
    expect(classifyColumnType('time').kind).toBe('time');
  });

  it('reads the declared length of text columns', () => {
    expect(classifyColumnType('VARCHAR(255)')).toMatchObject({ kind: 'text', maxLength: 255 });
    expect(classifyColumnType('character varying(50)')).toMatchObject({ kind: 'text', maxLength: 50 });
    expect(classifyColumnType('CHAR(2)')).toMatchObject({ kind: 'text', maxLength: 2 });
    expect(classifyColumnType('CHAR')).toMatchObject({ kind: 'text', maxLength: 1 });
    expect(classifyColumnType('TEXT')).toMatchObject({ kind: 'text' });
    expect(classifyColumnType('TEXT').maxLength).toBeUndefined();
    expect(classifyColumnType('VARCHAR').maxLength).toBeUndefined();
  });

  it('recognises arrays', () => {
    expect(classifyColumnType('text[]').kind).toBe('array');
    expect(classifyColumnType('INTEGER[3][3]').kind).toBe('array');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(classifyColumnType('  VarChar ( 20 ) ')).toMatchObject({ kind: 'text', maxLength: 20 });
  });

  it('reports a type it does not know as unknown, keeping the original text', () => {
    expect(classifyColumnType('order_status')).toEqual({ kind: 'unknown', raw: 'order_status' });
    expect(classifyColumnType('inet').kind).toBe('unknown');
  });
});
