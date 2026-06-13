// Drizzle client — connects to Aurora/Supabase using the pooled DATABASE_URL
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let pool: Pool;

try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
} catch (e) {
  console.error(e);
}

export const db = drizzle(pool!, { schema });


