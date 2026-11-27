import type {
  FieldDiff,
  PreviewChanges,
  Showtime,
  ShowtimeAdd,
} from "~/types/assessment";
import { ApiError } from "~/server/errors";

const columns = [
  "theater_name",
  "movie_title",
  "auditorium",
  "start_time",
  "end_time",
  "language",
  "format",
  "rating",
  "last_updated",
] as const;

export type CsvRow = ShowtimeAdd & { theaterName: string };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, "");

  const pushRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char ?? "";
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      pushRow();
      continue;
    }
    cell += char ?? "";
  }

  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

function isoTime(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(422, `${label} is not a valid time: ${value}`);
  }
  return parsed.toISOString();
}

function showtimeKey(title: string, startTime: string): string {
  return `${title.trim()}\n${isoTime(startTime, "start_time")}`;
}

export function rowsFromCsv(csv: string, theaterName: string): CsvRow[] {
  const table = parseCsv(csv);
  const header = table[0]?.map((column) => column.trim());
  if (header?.join(",") !== columns.join(",")) {
    throw new ApiError(422, `CSV header must be ${columns.join(",")}.`);
  }

  const body = table.slice(1);
  if (body.length === 0) {
    throw new ApiError(422, "CSV has no showtimes.");
  }

  const byKey = new Map<string, CsvRow>();
  for (const cells of body) {
    const record = Object.fromEntries(
      columns.map((column, index) => [column, (cells[index] ?? "").trim()]),
    );
    if (record.theater_name !== theaterName) {
      const foundName = record.theater_name ?? "";
      const foundTheater = foundName.length > 0 ? foundName : "a blank theater";
      throw new ApiError(
        422,
        `Every row must be for ${theaterName}. Found ${foundTheater}.`,
      );
    }
    for (const column of columns) {
      if (!record[column]) {
        throw new ApiError(422, `${column} is blank.`);
      }
    }

    const row: CsvRow = {
      theaterName: record.theater_name ?? "",
      movieTitle: record.movie_title ?? "",
      auditorium: record.auditorium ?? "",
      startTime: isoTime(record.start_time ?? "", "start_time"),
      endTime: isoTime(record.end_time ?? "", "end_time"),
      language: record.language ?? "",
      format: record.format ?? "",
      rating: record.rating ?? "",
    };
    byKey.set(showtimeKey(row.movieTitle, row.startTime), row);
  }

  return [...byKey.values()];
}

function pushDiff(diffs: FieldDiff[], field: string, oldValue: string, newValue: string) {
  if (oldValue !== newValue) {
    diffs.push({ field, oldValue, newValue });
  }
}

export function buildPreview(
  theaterName: string,
  current: Showtime[],
  csv: string,
): PreviewChanges {
  return buildPreviewFromRows(current, rowsFromCsv(csv, theaterName));
}

export function buildPreviewFromRows(
  current: Showtime[],
  incomingRows: CsvRow[],
): PreviewChanges {
  const incomingByKey = new Map<string, CsvRow>();
  for (const row of incomingRows) {
    incomingByKey.set(showtimeKey(row.movieTitle, row.startTime), row);
  }
  const incoming = [...incomingByKey.values()];
  const currentByKey = new Map(
    current.map((showtime) => [
      showtimeKey(showtime.movieTitle, showtime.startTime),
      showtime,
    ]),
  );
  const incomingKeys = new Set(
    incoming.map((row) => showtimeKey(row.movieTitle, row.startTime)),
  );

  const adds: PreviewChanges["adds"] = [];
  const updates: PreviewChanges["updates"] = [];

  for (const row of incoming) {
    const existing = currentByKey.get(showtimeKey(row.movieTitle, row.startTime));
    if (!existing) {
      adds.push({
        movieTitle: row.movieTitle,
        auditorium: row.auditorium,
        startTime: row.startTime,
        endTime: row.endTime,
        language: row.language,
        format: row.format,
        rating: row.rating,
      });
      continue;
    }

    const diffs: FieldDiff[] = [];
    pushDiff(diffs, "movieTitle", existing.movieTitle, row.movieTitle);
    pushDiff(diffs, "auditorium", existing.auditorium, row.auditorium);
    if (new Date(existing.endTime).getTime() !== new Date(row.endTime).getTime()) {
      diffs.push({ field: "endTime", oldValue: existing.endTime, newValue: row.endTime });
    }
    pushDiff(diffs, "language", existing.language, row.language);
    pushDiff(diffs, "format", existing.format, row.format);
    pushDiff(diffs, "rating", existing.rating, row.rating);
    if (existing.status !== "active") {
      pushDiff(diffs, "status", existing.status, "active");
    }
    if (diffs.length === 0) continue;

    updates.push({
      id: existing.id,
      movieTitle: row.movieTitle,
      startTime: row.startTime,
      endTime: row.endTime,
      diffs,
    });
  }

  const archives = current
    .filter(
      (showtime) =>
        showtime.status !== "archived" &&
        !incomingKeys.has(showtimeKey(showtime.movieTitle, showtime.startTime)),
    )
    .map((showtime) => ({
      id: showtime.id,
      movieTitle: showtime.movieTitle,
      startTime: showtime.startTime,
      endTime: showtime.endTime,
    }));

  return { adds, updates, archives };
}
