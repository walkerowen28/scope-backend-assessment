export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    return Response.json(
      { error: "That movie and start time is already on the schedule." },
      { status: 409 },
    );
  }

  console.error(error);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
