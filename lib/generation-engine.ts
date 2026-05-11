// lib/generation-engine.ts
import { faker } from '@faker-js/faker';

export type Row = Record<string, unknown>;

export type Rule = {
  strategy?: 'template' | 'faker' | 'mutate_seed' | 'foreign_key';
  template?: string;
  faker_method?: string;
};

export class DeterministicGenerator {
  constructor(
    private seedRows: Row[],
    private rules: Record<string, Rule>,
    locale: string = 'en'
  ) {
    // Set locale if needed, defaulting to standard English
    faker.seed(123); // Optional: makes generation reproducible during testing
  }

  async generateSingleRow(index: number): Promise<Row> {
    const row: Row = {};
    
    // Pick a random seed row to act as the "base" DNA for this new row
    const baseDNA = this.seedRows[index % this.seedRows.length];

    for (const [columnName, rule] of Object.entries(this.rules)) {
      row[columnName] = await this.applyStrategy(rule, baseDNA, row);
    }
    
    return row;
  }

  private async applyStrategy(rule: Rule | undefined, baseDNA: unknown, currentRow: Row): Promise<unknown> {
    if (!rule) return baseDNA;

    switch (rule.strategy) {
      case 'template':
        // Example: "{first_name}.{last_name}@{domain}"
        if (!rule.template) return baseDNA;
        let result = rule.template;
        for (const [key, value] of Object.entries(currentRow)) {
          result = result.replace(new RegExp(`{${key}}`, 'g'), String(value).toLowerCase());
        }
        return result;
      
      case 'faker':
        try {
          // Safe eval of faker methods defined by Gemini (e.g., 'person.firstName')
          const [module, method] = (rule.faker_method || '').split('.');
          if (!module || !method) return baseDNA;
          const fakerModule = (faker as unknown as Record<string, Record<string, () => unknown>>)[module];
          const fakerMethod = fakerModule?.[method];
          return typeof fakerMethod === 'function' ? fakerMethod() : baseDNA;
        } catch (e) {
          return baseDNA; // Fallback to seed data if faker method fails
        }
      
      case 'mutate_seed':
        // Take the seed data and add a random variation (+/- 10%)
        return typeof baseDNA === 'number'
          ? baseDNA * (1 + (Math.random() * 0.2 - 0.1))
          : baseDNA;
          
      case 'foreign_key':
      default:
        return baseDNA; 
    }
  }

  formatAsSQL(row: Row, tableName: string): string {
    const columns = Object.keys(row).join(', ');
    const values = Object.values(row).map(v => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return v;
      // Escape SQL single quotes to prevent injection/syntax errors
      return `'${String(v).replace(/'/g, "''")}'`; 
    }).join(', ');
    
    return `INSERT INTO ${tableName} (${columns}) VALUES (${values});\n`;
  }
}