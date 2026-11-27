import { env } from "~/env";
import type { CsvRow } from "~/server/csv-diff";
import { sql } from "~/server/db";
import { ApiError } from "~/server/errors";
import { canonicalTitle } from "~/server/identity";
import { ensureAuditorium } from "~/server/showtimes";

export type NameCatalog = {
  titles: string[];
  auditoriums: string[];
};

type NameField = "movieTitle" | "auditorium";

type PendingName = {
  field: NameField;
  value: string;
};

type GeminiResolution = {
  field?: string;
  input?: string;
  existingName?: string | null;
  cleanedName?: string | null;
};

export async function loadNameCatalog(theaterId: string): Promise<NameCatalog> {
  const titles = await sql<{ movie_title: string }[]>`
    select distinct movie_title
    from public.showtimes
    where theater_id = ${theaterId}
    order by movie_title
  `;
  const rooms = await sql<{ name: string }[]>`
    select name
    from public.auditoriums
    where theater_id = ${theaterId}
    order by name
  `;
  return {
    titles: titles.map((row) => row.movie_title),
    auditoriums: rooms.map((row) => row.name),
  };
}

function withoutNotes(value: string): string {
  return value
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameName(left: string, right: string): boolean {
  if (left === right || canonicalTitle(left) === canonicalTitle(right)) return true;
  const leftBase = withoutNotes(left);
  const rightBase = withoutNotes(right);
  return leftBase === rightBase || canonicalTitle(leftBase) === canonicalTitle(rightBase);
}

export function matchKnownName(value: string, known: string[]): string | null {
  const matches = known.filter((name) => sameName(value, name));
  if (matches.length === 0) return null;
  return matches.sort((left, right) => left.length - right.length)[0] ?? null;
}

export function unresolvedNames(rows: CsvRow[], catalog: NameCatalog): PendingName[] {
  const titles = catalog.titles;
  const rooms = catalog.auditoriums;
  const pending = new Map<string, PendingName>();

  for (const row of rows) {
    if (!matchKnownName(row.movieTitle, titles)) {
      pending.set(`movieTitle\n${row.movieTitle}`, {
        field: "movieTitle",
        value: row.movieTitle,
      });
    }
    if (!matchKnownName(row.auditorium, rooms)) {
      pending.set(`auditorium\n${row.auditorium}`, {
        field: "auditorium",
        value: row.auditorium,
      });
    }
  }

  return [...pending.values()];
}

function acceptedName(
  input: string,
  existingName: string | null | undefined,
  cleanedName: string | null | undefined,
  known: string[],
): string {
  const cleaned = cleanedName?.trim() || input;
  const chosen = existingName && known.includes(existingName) ? existingName : cleaned;
  return matchKnownName(chosen, known) ?? matchKnownName(input, known) ?? chosen;
}

function decisionKey(field: NameField, value: string): string {
  return `${field}\n${value}`;
}

export function applyResolvedNames(
  rows: CsvRow[],
  catalog: NameCatalog,
  decisions: Map<string, string>,
): CsvRow[] {
  const titles = catalog.titles;
  const rooms = catalog.auditoriums;

  return rows.map((row) => ({
    ...row,
    movieTitle:
      matchKnownName(row.movieTitle, titles) ??
      decisions.get(decisionKey("movieTitle", row.movieTitle)) ??
      row.movieTitle,
    auditorium:
      matchKnownName(row.auditorium, rooms) ??
      decisions.get(decisionKey("auditorium", row.auditorium)) ??
      row.auditorium,
  }));
}

function promptFor(pending: PendingName[], catalog: NameCatalog): string {
  const titles = catalog.titles;
  const rooms = catalog.auditoriums;
  return `You normalize movie titles and auditorium names for one theater.

Known movie titles, copied exactly:
${JSON.stringify(titles)}

Known auditorium names, copied exactly:
${JSON.stringify(rooms)}

Values that are not already known:
${JSON.stringify(pending)}

For each value, decide whether it is the same movie or the same room as one known name.
- Prefer a known name whenever the incoming value is that name plus a typo, abbreviation, number word, or extra note. "Spiderman Homecoming" and "Spider Man - Homecoming" are "Spider-Man: Homecoming" when that title is known. "Aud 1", "Aud2", "Auditorium Two", and "Auditorium 1 (Laser)" are the known room they point at.
- Return a new name only when no known name is a reasonable base. A room number that does not exist, such as "Auditorium 5" when only Auditorium 1 through 4 are known, is new.
- existingName must be copied from the known list, or null.
- cleanedName is existingName when it matches. When it is new, cleanedName is the input with extra spaces removed and obvious capitalization fixed, keeping words that make it a different title or room.

Return JSON: {"resolutions":[{"field":"movieTitle"|"auditorium","input":"the value you were given","existingName":"known name or null","cleanedName":"display name","reason":"one sentence"}]}`;
}

function parseResolutions(text: string): GeminiResolution[] {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ApiError(502, "Gemini returned a response that was not valid JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("resolutions" in parsed) ||
    !Array.isArray(parsed.resolutions)
  ) {
    throw new ApiError(502, "Gemini returned a response that was not valid JSON.");
  }
  return parsed.resolutions as GeminiResolution[];
}

async function askGemini(
  pending: PendingName[],
  catalog: NameCatalog,
): Promise<Map<string, string>> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ApiError(500, "GEMINI_API_KEY is missing.");
  }

  const model = env.GEMINI_MODEL ?? "gemini-3.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: promptFor(pending, catalog) }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );

  if (!response.ok) {
    throw new ApiError(502, `Gemini could not sanitize the CSV (${response.status}).`);
  }

  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!text) {
    throw new ApiError(502, "Gemini returned an empty response.");
  }

  const titles = catalog.titles;
  const rooms = catalog.auditoriums;
  const decisions = new Map<string, string>();
  for (const resolution of parseResolutions(text)) {
    if (resolution.field !== "movieTitle" && resolution.field !== "auditorium") continue;
    if (!resolution.input) continue;
    const known = resolution.field === "movieTitle" ? titles : rooms;
    decisions.set(
      decisionKey(resolution.field, resolution.input),
      acceptedName(resolution.input, resolution.existingName, resolution.cleanedName, known),
    );
  }
  return decisions;
}

export async function resolveImportedRows(
  theaterId: string,
  rows: CsvRow[],
): Promise<CsvRow[]> {
  const catalog = await loadNameCatalog(theaterId);
  const pending = unresolvedNames(rows, catalog);
  const decisions =
    pending.length > 0 ? await askGemini(pending, catalog) : new Map<string, string>();
  const resolved = applyResolvedNames(rows, catalog, decisions);

  const savedRooms = new Set(catalog.auditoriums);
  for (const row of resolved) {
    if (matchKnownName(row.auditorium, [...savedRooms])) continue;
    await ensureAuditorium(sql, theaterId, row.auditorium);
    savedRooms.add(row.auditorium);
  }

  return resolved;
}
