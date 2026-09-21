// lib/dependency-resolver.ts
//
// Kahn's-algorithm topological sort over a table's foreign-key relationships.
//
// This is the ONLY place table generation order is decided. Groq (lib/groq.ts)
// is asked for column-level semantic classification only; its own `topology`
// field, if it returns one, is read for logging/comparison purposes elsewhere
// and never used for ordering. See lib/schema-analysis.ts, the sole caller of
// resolveGenerationOrder() in the live pipeline.
//
// The core loop (in-degree map, adjacency list, queue-based BFS) is unchanged
// from the original implementation. What's new here is that it now (a) checks
// referenced tables actually exist before building the graph, so a dangling
// FK is reported by name instead of silently ignored, and (b) reports exactly
// which tables are involved when a cycle prevents a full ordering, instead of
// returning a boolean flag with no detail.

export interface TableNode {
  name: string;
  foreignKeys: { column: string; referencesTable: string; referencesColumn?: string }[];
}

export interface DependencyIssue {
  type: 'missing_parent_table' | 'circular_dependency';
  message: string;
  tables: string[];
}

export interface DependencyResolution {
  /** Topological order, parents before children. Only meaningful when ok === true. */
  order: string[];
  ok: boolean;
  issues: DependencyIssue[];
}

/**
 * A self-referencing FK (a table whose FK points at its own table) does not
 * create an ordering constraint against anything else, so it's excluded from
 * the graph — matching the original implementation's behaviour.
 */
export function resolveGenerationOrder(tables: TableNode[]): DependencyResolution {
  const tableNames = new Set(tables.map((t) => t.name));

  const missing: DependencyIssue[] = [];
  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      if (fk.referencesTable !== t.name && !tableNames.has(fk.referencesTable)) {
        missing.push({
          type: 'missing_parent_table',
          message: `${t.name}.${fk.column} references "${fk.referencesTable}", which is not a known table in this schema.`,
          tables: [t.name, fk.referencesTable],
        });
      }
    }
  }
  if (missing.length > 0) {
    return { order: [], ok: false, issues: missing };
  }

  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  tables.forEach((t) => {
    inDegree.set(t.name, 0);
    graph.set(t.name, []);
  });

  tables.forEach((t) => {
    t.foreignKeys.forEach((fk) => {
      if (fk.referencesTable !== t.name) {
        graph.get(fk.referencesTable)?.push(t.name);
        inDegree.set(t.name, (inDegree.get(t.name) || 0) + 1);
      }
    });
  });

  const queue: string[] = [];
  const sortedOrder: string[] = [];

  inDegree.forEach((count, table) => {
    if (count === 0) queue.push(table);
  });
  queue.sort(); // deterministic order among tables with no ordering constraint between them

  while (queue.length > 0) {
    const current = queue.shift()!;
    sortedOrder.push(current);

    const neighbors = (graph.get(current) ?? []).slice().sort();
    neighbors.forEach((neighbor) => {
      inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    });
  }

  if (sortedOrder.length !== tables.length) {
    const involved = tables.map((t) => t.name).filter((n) => !sortedOrder.includes(n));
    return {
      order: [],
      ok: false,
      issues: [
        {
          type: 'circular_dependency',
          message: `Circular foreign-key dependency detected among: ${involved.join(', ')}.`,
          tables: involved,
        },
      ],
    };
  }

  return { order: sortedOrder, ok: true, issues: [] };
}
