import type { Sql, TransactionSql } from "postgres";
import type {
  MovieStatus,
  PreviewChanges,
  Showtime,
  ShowtimeStatus,
} from "~/types/assessment";
import { ApiError } from "~/server/errors";
import { sql } from "~/server/db";
import { auditoriumId, canonicalTitle } from "~/server/identity";

type ShowtimeRow = {
  id: string;
  theater_id: string;
  movie_title: string;
  movie_status: MovieStatus;
  auditorium: string;
  start_time: Date;
  end_time: Date;
  language: string;
  format: string;
  rating: string;
  last_updated: Date;
  status: ShowtimeStatus;
};

const showtimeSelect = sql`
  s.id,
  s.theater_id,
  s.movie_title,
  s.movie_status,
  a.name as auditorium,
  s.start_time,
  s.end_time,
  s.language,
  s.format,
  s.rating,
  s.last_updated,
  s.status
`;

function toShowtime(row: ShowtimeRow): Showtime {
  return {
    id: row.id,
    theaterId: row.theater_id,
    movieTitle: row.movie_title,
    movieStatus: row.movie_status,
    auditorium: row.auditorium,
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
    language: row.language,
    format: row.format,
    rating: row.rating,
    lastUpdated: row.last_updated.toISOString(),
    status: row.status,
  };
}

export async function listShowtimes(theaterIds: string[]): Promise<Showtime[]> {
  if (theaterIds.length === 0) return [];

  const rows = await sql<ShowtimeRow[]>`
    select ${showtimeSelect}
    from public.showtimes s
    join public.auditoriums a on a.id = s.auditorium_id
    where s.theater_id = any(${theaterIds})
    order by s.start_time asc, s.id asc
  `;

  return rows.map(toShowtime);
}

export async function ensureAuditorium(
  tx: Sql | TransactionSql,
  theaterId: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  const id = auditoriumId(theaterId, trimmed);
  await tx`
    insert into public.auditoriums (id, theater_id, name)
    values (${id}, ${theaterId}, ${trimmed})
    on conflict (theater_id, name) do nothing
  `;
  const [row] = await tx<{ id: string }[]>`
    select id
    from public.auditoriums
    where theater_id = ${theaterId} and name = ${trimmed}
  `;
  if (!row) {
    throw new ApiError(500, "Could not save the auditorium.");
  }
  return row.id;
}

const updateFields = new Set([
  "movieTitle",
  "auditorium",
  "endTime",
  "language",
  "format",
  "rating",
  "status",
]);

export async function applyPreview(
  theaterId: string,
  changes: PreviewChanges,
): Promise<Showtime[]> {
  await sql.begin(async (tx) => {
    for (const archive of changes.archives) {
      const [existing] = await tx<{ id: string }[]>`
        update public.showtimes
        set status = 'archived', last_updated = now()
        where id = ${archive.id}
          and theater_id = ${theaterId}
          and status <> 'archived'
        returning id
      `;
      if (!existing) {
        throw new ApiError(
          409,
          `Showtime ${archive.id} is not an active row on this theater's schedule.`,
        );
      }
    }

    for (const add of changes.adds) {
      const roomId = await ensureAuditorium(tx, theaterId, add.auditorium);
      await tx`
        insert into public.showtimes (
          id,
          theater_id,
          auditorium_id,
          movie_title,
          canonical_title,
          movie_status,
          start_time,
          end_time,
          language,
          format,
          rating,
          last_updated,
          status
        )
        values (
          ${crypto.randomUUID()},
          ${theaterId},
          ${roomId},
          ${add.movieTitle.trim()},
          ${canonicalTitle(add.movieTitle)},
          ${"needs-review"},
          ${add.startTime},
          ${add.endTime},
          ${add.language.trim()},
          ${add.format.trim()},
          ${add.rating.trim()},
          ${new Date().toISOString()},
          ${"active"}
        )
      `;
    }

    for (const update of changes.updates) {
      const [existing] = await tx<{ id: string }[]>`
        select id
        from public.showtimes
        where id = ${update.id} and theater_id = ${theaterId}
      `;
      if (!existing) {
        throw new ApiError(409, `Showtime ${update.id} is not on this theater's schedule.`);
      }

      let movieTitle: string | null = null;
      let auditorium: string | null = null;
      let endTime: string | null = null;
      let language: string | null = null;
      let format: string | null = null;
      let rating: string | null = null;
      let status: ShowtimeStatus | null = null;

      for (const diff of update.diffs) {
        if (!updateFields.has(diff.field)) continue;
        if (diff.field === "movieTitle") movieTitle = diff.newValue.trim();
        if (diff.field === "auditorium") auditorium = diff.newValue.trim();
        if (diff.field === "endTime") endTime = diff.newValue;
        if (diff.field === "language") language = diff.newValue.trim();
        if (diff.field === "format") format = diff.newValue.trim();
        if (diff.field === "rating") rating = diff.newValue.trim();
        if (diff.field === "status") {
          if (!["active", "inactive", "archived"].includes(diff.newValue)) {
            throw new ApiError(400, "Invalid showtime status.");
          }
          status = diff.newValue as ShowtimeStatus;
        }
      }

      const roomId = auditorium
        ? await ensureAuditorium(tx, theaterId, auditorium)
        : null;

      await tx`
        update public.showtimes
        set
          movie_title = coalesce(${movieTitle}::text, movie_title),
          canonical_title = coalesce(${movieTitle === null ? null : canonicalTitle(movieTitle)}::text, canonical_title),
          auditorium_id = coalesce(${roomId}::text, auditorium_id),
          end_time = coalesce(${endTime}::timestamptz, end_time),
          language = coalesce(${language}::text, language),
          format = coalesce(${format}::text, format),
          rating = coalesce(${rating}::text, rating),
          status = coalesce(${status}::text, status),
          last_updated = now()
        where id = ${update.id} and theater_id = ${theaterId}
      `;
    }
  });

  return listShowtimes([theaterId]);
}

export async function archiveTheater(theaterId: string): Promise<Showtime[]> {
  await sql`
    update public.showtimes
    set status = 'archived', last_updated = now()
    where theater_id = ${theaterId} and status <> 'archived'
  `;
  return listShowtimes([theaterId]);
}

export async function updateShowtime(
  showtimeId: string,
  theaterIds: string[],
  patch: { movieStatus?: MovieStatus; status?: ShowtimeStatus },
): Promise<Showtime> {
  const updated = await sql<{ id: string }[]>`
    update public.showtimes
    set
      movie_status = coalesce(${patch.movieStatus ?? null}::text, movie_status),
      status = coalesce(${patch.status ?? null}::text, status),
      last_updated = now()
    where id = ${showtimeId}
      and theater_id = any(${theaterIds})
    returning id
  `;

  if (!updated[0]) {
    throw new ApiError(404, "Showtime not found.");
  }

  const rows = await sql<ShowtimeRow[]>`
    select ${showtimeSelect}
    from public.showtimes s
    join public.auditoriums a on a.id = s.auditorium_id
    where s.id = ${showtimeId}
  `;
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "Showtime not found.");
  }
  return toShowtime(row);
}
