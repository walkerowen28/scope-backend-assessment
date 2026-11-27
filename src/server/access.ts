import { ApiError } from "~/server/errors";
import { sql } from "~/server/db";

export type UserAccess = {
  role: "admin" | "viewer";
  theaterIds: string[];
};

export async function getUserAccess(userId: string): Promise<UserAccess> {
  const rows = await sql<{ role: "admin" | "viewer"; theater_id: string | null }[]>`
    select u.role, ut.theater_id
    from public.users u
    left join public.user_theaters ut on ut.user_id = u.id
    where u.id = ${userId}
  `;

  const first = rows[0];
  if (!first) {
    throw new ApiError(404, "User not found.");
  }

  return {
    role: first.role,
    theaterIds: rows.flatMap((row) => (row.theater_id ? [row.theater_id] : [])),
  };
}

export async function assertAdminOfTheater(userId: string, theaterId: string) {
  const access = await getUserAccess(userId);
  if (access.role !== "admin" || !access.theaterIds.includes(theaterId)) {
    throw new ApiError(403, "Only an admin of this theater can change the schedule.");
  }
  return access;
}
