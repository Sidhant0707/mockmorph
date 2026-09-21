import { describe, expect, it } from 'vitest';
import { resolveGenerationOrder, type TableNode } from '../dependency-resolver';

const node = (name: string, fks: Array<[string, string]> = []): TableNode => ({
  name,
  foreignKeys: fks.map(([column, referencesTable]) => ({ column, referencesTable })),
});

const before = (order: string[], a: string, b: string) => order.indexOf(a) < order.indexOf(b);

describe('resolveGenerationOrder (Kahn\'s algorithm)', () => {
  it('orders a simple chain: users -> orders -> order_items', () => {
    const tables = [
      node('users'),
      node('orders', [['user_id', 'users']]),
      node('order_items', [['order_id', 'orders']]),
    ];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(true);
    expect(result.order).toEqual(['users', 'orders', 'order_items']);
  });

  it('handles multiple independent parents feeding one child', () => {
    // orders.user_id -> users.id, orders.company_id -> companies.id
    const tables = [
      node('users'),
      node('companies'),
      node('orders', [
        ['user_id', 'users'],
        ['company_id', 'companies'],
      ]),
    ];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(true);
    expect(before(result.order, 'users', 'orders')).toBe(true);
    expect(before(result.order, 'companies', 'orders')).toBe(true);
  });

  it('handles disconnected tables (no FK relationship at all)', () => {
    const tables = [node('users'), node('products'), node('orders', [['user_id', 'users']])];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(true);
    expect(result.order).toContain('products');
    expect(before(result.order, 'users', 'orders')).toBe(true);
  });

  it('resolves a diamond: A->B->C, A->C, B->D, C->D', () => {
    const tables = [
      node('A'),
      node('B', [['a_id', 'A']]),
      node('C', [
        ['a_id', 'A'],
        ['b_id', 'B'],
      ]),
      node('D', [
        ['b_id', 'B'],
        ['c_id', 'C'],
      ]),
    ];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(true);
    expect(before(result.order, 'A', 'B')).toBe(true);
    expect(before(result.order, 'A', 'C')).toBe(true);
    expect(before(result.order, 'B', 'C')).toBe(true);
    expect(before(result.order, 'B', 'D')).toBe(true);
    expect(before(result.order, 'C', 'D')).toBe(true);
  });

  it('detects a 3-table cycle: A -> B -> C -> A', () => {
    const tables = [
      node('A', [['c_id', 'C']]),
      node('B', [['a_id', 'A']]),
      node('C', [['b_id', 'B']]),
    ];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(false);
    expect(result.issues[0].type).toBe('circular_dependency');
    expect(result.issues[0].tables.sort()).toEqual(['A', 'B', 'C']);
  });

  it('detects a cycle that only involves a subset of tables', () => {
    const tables = [
      node('users'),
      node('a', [['b_id', 'b']]),
      node('b', [['a_id', 'a']]),
    ];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(false);
    expect(result.issues[0].type).toBe('circular_dependency');
    expect(result.issues[0].tables.sort()).toEqual(['a', 'b']);
  });

  it('does not treat a self-referencing FK as a cycle', () => {
    // employees.manager_id -> employees.id
    const tables = [node('employees', [['manager_id', 'employees']])];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(true);
    expect(result.order).toEqual(['employees']);
  });

  it('orders a self-referencing table after its other parents', () => {
    const tables = [
      node('employees', [
        ['manager_id', 'employees'],
        ['department_id', 'departments'],
      ]),
      node('departments'),
    ];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(true);
    expect(result.order).toEqual(['departments', 'employees']);
  });

  it('still rejects a two-table cycle when one of the tables also references itself', () => {
    const tables = [
      node('a', [
        ['parent_id', 'a'],
        ['b_id', 'b'],
      ]),
      node('b', [['a_id', 'a']]),
      node('c', [['parent_id', 'c']]), // self-reference only: not part of the cycle
    ];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(false);
    expect(result.issues[0].type).toBe('circular_dependency');
    expect(result.issues[0].tables.sort()).toEqual(['a', 'b']);
  });

  it('reports a missing referenced table instead of silently ignoring it', () => {
    const tables = [node('orders', [['user_id', 'nonexistent']])];
    const result = resolveGenerationOrder(tables);
    expect(result.ok).toBe(false);
    expect(result.issues[0].type).toBe('missing_parent_table');
    expect(result.issues[0].message).toContain('nonexistent');
  });

  it('produces a deterministic order for independent tables', () => {
    const tables = [node('zebra'), node('apple'), node('mango')];
    const result = resolveGenerationOrder(tables);
    expect(result.order).toEqual(['apple', 'mango', 'zebra']);
  });
});
