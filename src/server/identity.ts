export function canonicalTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function auditoriumId(theaterId: string, name: string): string {
  const theater = theaterId.replace(/^theater-/, "");
  const normalized = name.trim().toLowerCase();
  const room = normalized.startsWith("auditorium")
    ? normalized.replace(/^auditorium\s+/, "")
    : normalized;
  return `aud-${theater}-${room.replace(/\s+/g, "-")}`;
}
