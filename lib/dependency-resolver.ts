// lib/dependency-resolver.ts
export interface TableNode {
  name: string;
  foreignKeys: { column: string; referencesTable: string }[];
}

export function resolveGenerationOrder(tables: TableNode[]) {
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>(); 
  
  tables.forEach(t => {
    inDegree.set(t.name, 0);
    graph.set(t.name, []);
  });

  tables.forEach(t => {
    t.foreignKeys.forEach(fk => {
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

  while (queue.length > 0) {
    const current = queue.shift()!;
    sortedOrder.push(current);

    graph.get(current)?.forEach(neighbor => {
      inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    });
  }

  const hasCircularDeps = sortedOrder.length !== tables.length;
  return { sortedOrder, hasCircularDeps };
}