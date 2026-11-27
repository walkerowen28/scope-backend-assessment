import { z } from "zod";
import { ApiError, apiResponse } from "~/server/errors";
import { getUserAccess } from "~/server/access";
import { updateShowtime } from "~/server/showtimes";

const patchSchema = z
  .object({
    userId: z.string().min(1),
    movieStatus: z.enum(["approved", "draft", "flagged", "needs-review"]).optional(),
    status: z.enum(["active", "inactive", "archived"]).optional(),
  })
  .refine((body) => body.movieStatus !== undefined || body.status !== undefined, {
    message: "Provide movieStatus or status.",
  });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());
    const access = await getUserAccess(body.userId);
    if (access.role !== "admin") {
      throw new ApiError(403, "Only an admin can change a showtime.");
    }

    const showtime = await updateShowtime(id, access.theaterIds, {
      movieStatus: body.movieStatus,
      status: body.status,
    });
    return Response.json(showtime);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid showtime update." }, { status: 400 });
    }
    return apiResponse(error);
  }
}
