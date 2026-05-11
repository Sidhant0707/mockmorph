import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

// Rate Limiting Constants
const RATE_LIMIT = 5;
const RESET_INTERVAL_MS = 60 * 60 * 1000; // 1 hour in milliseconds

export async function POST(req: Request) {
  try {
    // ---------------------------------------------------------
    // 1. AUTHENTICATION & SECURITY
    // ---------------------------------------------------------
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Safely access runtime id value
    const userId = (session.user as unknown as Record<string, unknown>).id;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ---------------------------------------------------------
    // 2. DATABASE-BACKED RATE LIMITING
    // ---------------------------------------------------------
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { analyzesUsed: true, lastResetTime: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const now = new Date();
    const timeSinceReset = now.getTime() - new Date(user.lastResetTime).getTime();

    // Check if the 1-hour window has expired
    if (timeSinceReset > RESET_INTERVAL_MS) {
      // Reset the window and count
      await prisma.user.update({
        where: { id: userId },
        data: {
          analyzesUsed: 1,
          lastResetTime: now,
        },
      });
    } else {
      // Window is active, check the limit
      if (user.analyzesUsed >= RATE_LIMIT) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please wait an hour before running another semantic analysis.' },
          { status: 429 }
        );
      }

      // Increment usage
      await prisma.user.update({
        where: { id: userId },
        data: {
          analyzesUsed: { increment: 1 },
        },
      });
    }

    // Calculate remaining uses for the frontend UI
    const remaining = RATE_LIMIT - (timeSinceReset > RESET_INTERVAL_MS ? 1 : user.analyzesUsed + 1);

    // ---------------------------------------------------------
    // 3. INPUT VALIDATION
    // ---------------------------------------------------------
    const body = await req.json() as { rawSchema?: unknown };
    const rawSchema = body.rawSchema;

    if (!rawSchema || typeof rawSchema !== 'string') {
      return NextResponse.json({ error: 'Valid SQL schema is required' }, { status: 400 });
    }

    // ---------------------------------------------------------
    // 4. GROQ AI EXECUTION (Replaced Gemini)
    // ---------------------------------------------------------
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY is missing' }, { status: 500 });
    }

    const aiPrompt = `Analyze this SQL schema and return a STRICT JSON object representing the database structure.
    Required format:
    {
      "topology": ["table1", "table2"],
      "tables": {
        "table_name": {
          "column_name": "semantic_type"
        }
      }
    }
    Allowed semantic types: pk, fk, email, fullname, price, product, company, phone, date, boolean, string
    Order tables in dependency order (parents before children).
    Schema to analyze:
    ${rawSchema}
    
    Return ONLY the raw JSON object.`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are an expert database analyzer. Always return strictly valid JSON matching the exact requested structure.' },
          { role: 'user', content: aiPrompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" } // Enforces strict JSON from Groq
      }),
    });

    if (!groqResponse.ok) {
       throw new Error(`Groq API Error: ${groqResponse.status}`);
    }

    const aiResult = await groqResponse.json();
    const text = aiResult.choices[0].message.content;

    // ---------------------------------------------------------
    // 5. STRICT JSON PARSING & SANITIZATION
    // ---------------------------------------------------------
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');

    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      throw new Error('AI response did not contain a valid JSON block');
    }

    const jsonString = text.substring(startIdx, endIdx + 1);
    
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e: unknown) {
      try {
        // Fallback sanitization for trailing commas
        const sanitized = jsonString.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        parsed = JSON.parse(sanitized);
      } catch {
        throw new Error('Failed to parse AI response as JSON even after sanitization');
      }
    }

    // ---------------------------------------------------------
    // 6. TYPE SAFETY & RESPONSE FORMATTING
    // ---------------------------------------------------------
    if (
      !parsed || 
      typeof parsed !== 'object' || 
      Array.isArray(parsed) || 
      !('topology' in parsed) || 
      !('tables' in parsed)
    ) {
       throw new Error('AI returned an invalid map structure');
    }

    const validParsed = parsed as Record<string, unknown>;

    const topology = Array.isArray(validParsed.topology) 
      ? validParsed.topology.flat(Infinity).map(String).filter(Boolean)
      : [];

    const tables = typeof validParsed.tables === 'object' && validParsed.tables !== null
      ? validParsed.tables as Record<string, Record<string, string>>
      : {};

    return NextResponse.json({ topology, tables, remaining });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown analysis error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}