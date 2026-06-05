import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

async function migrate() {
  const client = new Client({
    connectionString: DATABASE_URL,
  });

  try {
    // Read the schema SQL file
    const schemaPath = resolve(import.meta.dir, "schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf-8");

    // Connect to the database
    await client.connect();

    // Execute the schema SQL
    await client.query(schemaSql);

    console.log("Migration complete");
    process.exit(0);
  } catch (error) {
    console.error(
      "Migration failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
