import { z } from "zod";
import { ApiError, apiResponse } from "~/server/errors";
import { assertAdminOfTheater } from "~/server/access";
import { buildPreview } from "~/server/csv-diff";
import { sql } from "~/server/db";
import { listShowtimes } from "~/server/showtimes";

const bodySchema = z.object({
  userId: z.string().min(1),
  csv: z.string().min(1),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ theaterId: string }> },
) {
  try {
    const { theaterId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const access = await assertAdminOfTheater(body.userId, theaterId);
    const [theater] = await sql<{ name: string }[]>`
      select name from public.theaters where id = ${theaterId}
    `;
    if (!theater) {
      throw new ApiError(404, "Theater not found.");
    }

    const current = await listShowtimes(
      access.theaterIds.filter((id) => id === theaterId),
    );
    return Response.json(buildPreview(theater.name, current, body.csv));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "userId and csv are required." }, { status: 400 });
    }
    return apiResponse(error);
  }
}
