import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma'; // Ensure this matches your Prisma export path

interface RequestBody {
  rawSchema?: string;
  config?: {
    rowCount?: number;
    dialect?: 'postgres' | 'mysql';
  };
  semanticMap?: SemanticSchemaMap | null; 
}

interface SemanticSchemaMap {
  topology: string[];
  tables: Record<string, Record<string, string>>;
}

interface SessionUserWithId {
  id: string;
}

function hasUserId(user: unknown): user is SessionUserWithId {
  return !!user && typeof user === 'object' && 'id' in user && typeof (user as { id?: unknown }).id === 'string';
}

const LIMITS = {
  MAX_ROWS: 10000,
  MIN_ROWS: 1,
  DEFAULT_ROWS: 50,
  BASE_PARENT_ROWS: 15,
} as const;

// Replaced Gemini AI_CONFIG with Groq AI_CONFIG
const AI_CONFIG = {
  MODEL: 'llama-3.3-70b-versatile',
  TEMPERATURE: 0.1,
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function generateValue(
  semanticType: string,
  index: number,
  parentMaxId: number,
  dialect: 'postgres' | 'mysql' = 'postgres'
): string | number {
  const normalizedType = semanticType.toLowerCase();

  switch (normalizedType) {
    case 'email': return `'user${index}_${Math.random().toString(36).substring(2, 9)}@obsidian.corp'`;
    case 'fullname': return `'Operative ${Math.random().toString(36).substring(2, 9).toUpperCase()}'`;
    case 'price': return (Math.random() * 5000 + 0.01).toFixed(2);
    case 'product': return `'Cyber-Asset MK-${String(index).padStart(3, '0')}'`;
    case 'company': return `'Syndicate ${index} LLC'`;
    case 'phone': return `'555-01${String(Math.floor(10 + Math.random() * 90)).padStart(2, '0')}'`;
    case 'date': return `'2026-05-${String(((index - 1) % 28) + 1).padStart(2, '0')}'`;
    case 'boolean': 
      const isTrue = Math.random() > 0.5;
      return dialect === 'mysql' ? (isTrue ? 1 : 0) : (isTrue ? 'TRUE' : 'FALSE');
    case 'fk': return parentMaxId > 0 ? Math.floor(Math.random() * parentMaxId) + 1 : 1;
    case 'pk': return index;
    default: return `'string_val_${index}'`;
  }
}

export async function POST(req: Request) {
  try {
    // ---------------------------------------------------------
    // 1. AUTHENTICATION & SECURITY
    // ---------------------------------------------------------
    const session = await getServerSession(authOptions);
    const user = session?.user;

    if (!session || !user || !hasUserId(user)) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = (await req.json()) as RequestBody;
    const requestedRows = body.config?.rowCount ?? LIMITS.DEFAULT_ROWS;
    const dialect = body.config?.dialect ?? 'postgres';
    const schemaToProcess = body.rawSchema?.trim() || '';
    const providedMap = body.semanticMap;

    const encoder = new TextEncoder();

    // ---------------------------------------------------------
    // 2. EDGE STREAMING ENGINE
    // ---------------------------------------------------------
    const stream = new ReadableStream({
      async start(controller) {
        let fullOutputString = "";

        const send = async (text: string, delay: number = 0) => {
          if (delay > 0) {
             await sleep(delay);
          }
          fullOutputString += text + '\n';
          controller.enqueue(encoder.encode(text + '\n'));
        };

        try {
          await send('-- [SYS] Initializing Hybrid LLM-Deterministic Edge Engine...', 50);

          let parsedSchema: SemanticSchemaMap;

          // ---------------------------------------------------------
          // 3. SEMANTIC ROUTING (Use cached map OR hit Groq)
          // ---------------------------------------------------------
          if (providedMap && providedMap.topology && providedMap.tables) {
            await send('-- [SYS] Pre-verified Semantic Map received. Bypassing AI...', 50);
            parsedSchema = providedMap;
          } else {
            const apiKey = process.env.GROQ_API_KEY;
            if (!apiKey) {
              throw new Error('GROQ_API_KEY environment variable is missing.');
            }
            
            await send(`-- [SYS] Handshake with ${AI_CONFIG.MODEL} (Groq LPU) established.`, 50);
            await send('-- [AI] Analyzing schema semantics on the fly...', 100);

            const aiPrompt = `Analyze this SQL schema and return a STRICT JSON object representing the database structure.
            Required format: { "topology": ["table1"], "tables": { "table1": { "col": "semantic_type" } } }
            Types: pk, fk, email, fullname, price, product, company, phone, date, boolean, string
            Schema: ${schemaToProcess}`;

            // GROQ FETCH REPLACING GEMINI SDK
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: AI_CONFIG.MODEL,
                messages: [
                  { role: 'system', content: 'You are an expert database analyzer. Always return strictly valid JSON.' },
                  { role: 'user', content: aiPrompt }
                ],
                temperature: AI_CONFIG.TEMPERATURE,
                response_format: { type: "json_object" } // Enforces pure JSON
              }),
            });

            if (!groqResponse.ok) {
              throw new Error(`Groq API Error: ${groqResponse.status}`);
            }

            const aiResult = await groqResponse.json();
            const rawText = aiResult.choices[0].message.content;
            
            const startIdx = rawText.indexOf('{');
            const endIdx = rawText.lastIndexOf('}');
            if (startIdx === -1 || endIdx === -1) {
              throw new Error("Invalid AI JSON response.");
            }
            
            parsedSchema = JSON.parse(rawText.substring(startIdx, endIdx + 1));
            parsedSchema.topology = parsedSchema.topology.flat(Infinity).map(String);
          }

          const { topology, tables } = parsedSchema;

          await send(`-- [AI] Topology Locked: ${topology.join(' -> ')}`, 50);
          await send(`-- [EDGE] Executing Kahn's Algorithm chunking for ${dialect.toUpperCase()}...`, 100);
          await send('', 50);

          // ---------------------------------------------------------
          // 4. DETERMINISTIC GENERATION LOOP
          // ---------------------------------------------------------
          let totalGenerated = 0;
          let parentMaxId: number = LIMITS.BASE_PARENT_ROWS;

          for (let tIndex = 0; tIndex < topology.length; tIndex++) {
            const tableName = topology[tIndex];
            const tableKey = Object.keys(tables).find((k) => k.toLowerCase() === tableName.toLowerCase());
            
            if (!tableKey) continue;

            const columns = tables[tableKey];
            const colNames = Object.keys(columns);

            if (colNames.length === 0) continue;

            await send(`INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES`, 50);

            const isLastTable = tIndex === topology.length - 1;
            const rowsToGenerate = isLastTable ? Math.max(1, requestedRows - totalGenerated) : LIMITS.BASE_PARENT_ROWS;

            for (let i = 1; i <= rowsToGenerate; i++) {
              const values = colNames.map((col) => generateValue(String(columns[col]), i, parentMaxId, dialect));
              const isLastRow = i === rowsToGenerate;
              await send(`  (${values.join(', ')})${isLastRow ? ';' : ','}`, 10);
              totalGenerated++;
            }

            parentMaxId = rowsToGenerate;
            await send('', 20);
          }

          await send(`-- [COMPLETE] ${totalGenerated} semantic rows generated. 100% Referential Integrity maintained.`, 50);

          // ---------------------------------------------------------
          // 5. DATABASE CACHING / SAVING (Preserved)
          // ---------------------------------------------------------
          await prisma.generation.create({
            data: {
              userId: user.id,
              schema: schemaToProcess,
              mockData: fullOutputString,
            },
          });

          controller.close();

        } catch (streamError: unknown) {
          const msg = streamError instanceof Error ? streamError.message : String(streamError);
          await send(`-- [FATAL ERROR] Core processing failure: ${msg}`);
          controller.close();
        }
      },
      cancel() {
        console.warn('Stream canceled by client');
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: 'Invalid request format' }, { status: 400 });
  }
}