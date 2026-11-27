import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { assessmentData } from "../src/data/assessment-data.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing. Add it to .env, then rerun npm run db:setup.");
}

if (databaseUrl.includes("zdpzoremwtdcrwpajtmo")) {
  throw new Error(
    "DATABASE_URL points at the shared assessment database. Put your own Supabase session-pooler URI in .env.",
  );
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function canonicalTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function auditoriumId(theaterId: string, name: string): string {
  const theater = theaterId.replace(/^theater-/, "");
  const normalized = name.trim().toLowerCase();
  const room = normalized.startsWith("auditorium")
    ? normalized.replace(/^auditorium\s+/, "")
    : normalized;
  return `aud-${theater}-${room.replace(/\s+/g, "-")}`;
}

const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

try {
  const schema = readFileSync(path.join(root, "db/schema.sql"), "utf8");
  const statements = schema
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await sql.unsafe(statement);
  }

  const auditoriums = new Map<string, { id: string; theater_id: string; name: string }>();
  for (const showtime of assessmentData.showtimes) {
    const id = auditoriumId(showtime.theaterId, showtime.auditorium);
    auditoriums.set(id, {
      id,
      theater_id: showtime.theaterId,
      name: showtime.auditorium,
    });
  }

  const memberships = assessmentData.users.flatMap((user) =>
    user.theaterIds.map((theaterId) => ({
      user_id: user.id,
      theater_id: theaterId,
    })),
  );

  await sql.begin(async (tx) => {
    await tx`
      insert into public.theaters ${tx(
        assessmentData.theaters.map((theater) => ({
          id: theater.id,
          name: theater.name,
          location: theater.location,
          timezone: theater.timezone,
        })),
        "id",
        "name",
        "location",
        "timezone",
      )}
      on conflict (id) do update set
        name = excluded.name,
        location = excluded.location,
        timezone = excluded.timezone
    `;

    await tx`
      insert into public.users ${tx(
        assessmentData.users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        })),
        "id",
        "name",
        "email",
        "role",
      )}
      on conflict (id) do update set
        name = excluded.name,
        email = excluded.email,
        role = excluded.role
    `;

    await tx`
      insert into public.auditoriums ${tx(
        [...auditoriums.values()],
        "id",
        "theater_id",
        "name",
      )}
      on conflict (id) do update set
        theater_id = excluded.theater_id,
        name = excluded.name
    `;

    if (memberships.length > 0) {
      await tx`
        insert into public.user_theaters ${tx(memberships, "user_id", "theater_id")}
        on conflict (user_id, theater_id) do nothing
      `;
    }

    await tx`
      insert into public.showtimes ${tx(
        assessmentData.showtimes.map((showtime) => ({
          id: showtime.id,
          theater_id: showtime.theaterId,
          auditorium_id: auditoriumId(showtime.theaterId, showtime.auditorium),
          movie_title: showtime.movieTitle,
          canonical_title: canonicalTitle(showtime.movieTitle),
          movie_status: showtime.movieStatus,
          start_time: showtime.startTime,
          end_time: showtime.endTime,
          language: showtime.language,
          format: showtime.format,
          rating: showtime.rating,
          last_updated: showtime.lastUpdated,
          status: showtime.status,
        })),
        "id",
        "theater_id",
        "auditorium_id",
        "movie_title",
        "canonical_title",
        "movie_status",
        "start_time",
        "end_time",
        "language",
        "format",
        "rating",
        "last_updated",
        "status",
      )}
      on conflict (id) do update set
        theater_id = excluded.theater_id,
        auditorium_id = excluded.auditorium_id,
        movie_title = excluded.movie_title,
        canonical_title = excluded.canonical_title,
        movie_status = excluded.movie_status,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        language = excluded.language,
        format = excluded.format,
        rating = excluded.rating,
        last_updated = excluded.last_updated,
        status = excluded.status
    `;
  });

  const [counts] = await sql<
    {
      theaters: number;
      users: number;
      user_theaters: number;
      auditoriums: number;
      showtimes: number;
    }[]
  >`
    select
      (select count(*) from public.theaters) as theaters,
      (select count(*) from public.users) as users,
      (select count(*) from public.user_theaters) as user_theaters,
      (select count(*) from public.auditoriums) as auditoriums,
      (select count(*) from public.showtimes) as showtimes
  `;

  console.log(
    `Seeded theaters=${counts?.theaters} users=${counts?.users} user_theaters=${counts?.user_theaters} auditoriums=${counts?.auditoriums} showtimes=${counts?.showtimes}`,
  );
} finally {
  await sql.end();
}
