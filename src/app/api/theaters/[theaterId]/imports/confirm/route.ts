import { z } from "zod";
import { apiResponse } from "~/server/errors";
import { assertAdminOfTheater } from "~/server/access";
import { applyPreview } from "~/server/showtimes";

const changesSchema = z.object({
  adds: z.array(
    z.object({
      movieTitle: z.string().min(1),
      auditorium: z.string().min(1),
      startTime: z.string().datetime(),
      endTime: z.string().datetime(),
      language: z.string().min(1),
      format: z.string().min(1),
      rating: z.string().min(1),
    }),
  ),
  updates: z.array(
    z.object({
      id: z.string().min(1),
      movieTitle: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      diffs: z.array(
        z.object({
          field: z.string(),
          oldValue: z.string(),
          newValue: z.string(),
        }),
      ),
    }),
  ),
  archives: z.array(
    z.object({
      id: z.string().min(1),
      movieTitle: z.string(),
      startTime: z.string(),
      endTime: z.string(),
    }),
  ),
});

const bodySchema = z.object({
  userId: z.string().min(1),
  changes: changesSchema,
});

export async function POST(
  request: Request,
  context: { params: Promise<{ theaterId: string }> },
) {
  try {
    const { theaterId } = await context.params;
    const body = bodySchema.parse(await request.json());
    await assertAdminOfTheater(body.userId, theaterId);
    return Response.json(await applyPreview(theaterId, body.changes));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid preview." }, { status: 400 });
    }
    return apiResponse(error);
  }
}
