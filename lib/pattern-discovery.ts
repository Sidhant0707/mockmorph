// lib/pattern-discovery.ts
import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai';
import { TableNode } from './dependency-resolver';

// Initialize the SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// 1. Define the Strict Structured Output Schema
const generationRulesSchema = {
  type: SchemaType.OBJECT,
  properties: {
    generation_rules: {
      type: SchemaType.OBJECT,
      description: "Mapping of column names to their Faker.js generation strategies.",
      properties: {},
      additionalProperties: true
    },
    seed_rows: {
      type: SchemaType.ARRAY,
      description: "Exactly 50 highly realistic seed rows based on the schema relationships.",
      items: {
        type: SchemaType.OBJECT,
        properties: {},
        additionalProperties: true
      }
    }
  },
  required: ["generation_rules", "seed_rows"]
};

export async function discoverPatterns(tables: TableNode[], targetTable: string) {
  // 2. Instantiate gemini-2.5-flash Pro with strict JSON configs
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      // Cast to unknown then to object to avoid using `any` while satisfying the SDK typing
        responseSchema: generationRulesSchema as Schema,
      temperature: 0.1, // Extremely low temp for deterministic integrity
    }
  });

  // 3. The Prompt Engineering (Injecting Kahn's Algorithm context)
  const prompt = `
    You are MockMorph, an enterprise-grade database mock data generator.
    Analyze the following relational schema:
    ${JSON.stringify(tables, null, 2)}

    Your task is to generate the pattern discovery rules and seed data for the table: '${targetTable}'.

    INSTRUCTIONS:
    1. 'generation_rules': For every column in '${targetTable}', provide a strategy. 
       - If it's a standard field (name, email), use strategy: 'faker' and provide the 'faker_method' (e.g., 'person.firstName', 'internet.email').
       - If it's derived, use strategy: 'template' and provide the 'template' string (e.g., '{first_name}.{last_name}@company.com').
       - If it's a foreign key, use strategy: 'foreign_key'.
    2. 'seed_rows': Generate exactly 50 realistic JSON objects representing rows for this table.
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Guaranteed to be parseable JSON thanks to Structured Outputs
    return JSON.parse(responseText);
  } catch (error) {
    console.error(`[AI Engine] Failed pattern discovery for ${targetTable}:`, error);
    throw new Error("Failed to generate data dictionary.");
  }
}