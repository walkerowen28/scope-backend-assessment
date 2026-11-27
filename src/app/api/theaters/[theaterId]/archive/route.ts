import { z } from "zod";
import { apiResponse } from "~/server/errors";
import { assertAdminOfTheater } from "~/server/access";
import { archiveTheater } from "~/server/showtimes";

const bodySchema = z.object({
  userId: z.string().min(1),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ theaterId: string }> },
) {
  try {
    const { theaterId } = await context.params;
    const body = bodySchema.parse(await request.json());
    await assertAdminOfTheater(body.userId, theaterId);
    return Response.json(await archiveTheater(theaterId));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }
    return apiResponse(error);
  }
}
