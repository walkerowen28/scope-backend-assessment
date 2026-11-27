import { ApiError, apiResponse } from "~/server/errors";
import { getUserAccess } from "~/server/access";
import { listShowtimes } from "~/server/showtimes";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const theaterId = url.searchParams.get("theaterId");
    if (!userId) {
      throw new ApiError(400, "userId is required.");
    }

    const access = await getUserAccess(userId);
    if (theaterId && !access.theaterIds.includes(theaterId)) {
      throw new ApiError(403, "This user cannot view that theater.");
    }

    const theaterIds = theaterId ? [theaterId] : access.theaterIds;
    return Response.json(await listShowtimes(theaterIds));
  } catch (error) {
    return apiResponse(error);
  }
}
