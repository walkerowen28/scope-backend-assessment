# LLM CSV reconciliation

This document outlines how I enhanced the CSV upload feature. I implemented an LLM agent to check uploaded showings for title/auditorium typos, to prevent accidental changes to these fields in showing records.

## 1. Stages

I used an AI coding assistant, Cursor, to accelerate development. I broke the feature request into pieces: design/plan, implementation, review, testing. This made the project more granular and digestable.

**Stage 1 — database and seed.** 

- Design: I turned the hardcoded JSON into five Postgres tables: `theaters`, `users`, `user_theaters`, `auditoriums`, and `showtimes`. `npm run db:setup` creates them and upserts `src/data/assessment-data.ts`.
- Implementation: I created Supabase Postgres DB, I downloaded DBeaver to view tables, Cursor implemented seed script
- Review/Pushback: I pushed back on a separate `auditorium_theaters` join. A room belongs to one theater, so `auditoriums` has `theater_id` and `name`. I also dropped a unique index on `users.email`. Nothing looks users up by email. I stopped a setup run against the shared assessment database and pointed `DATABASE_URL` at my own Supabase project.

**Stage 2 — REST, wired to the existing page.** 

- Design: The page originally used hardcoded data in typescript. Created REST endooints for displaying Showtimes, editing status, clearing schedule, CSV preview, and confirm became Next.js route handlers under `src/app/api`. The Python `backend/` app stays the unused health-check scaffold so one Vercel project can serve the UI and the API.
- Implementation: Cursor
- Review/Pushback: I pushed back on `GET /api/users` and `GET /api/theaters`. The screen never creates either, so those dropdowns stay on the hardcoded lists. I also rejected an `import_previews` table. The preview route only returns the diff. Confirm posts that same diff back, and that request is what writes.

**Stage 3 — sanitize titles and rooms, then diff.** 

- Design: Exact and normalized names are resolved locally. Only unknown movie titles and auditorium names go to Gemini, with the names already stored for that theater. A match with no real field change is left out of the preview. A new room is inserted into `auditoriums`. A new showing is an add and is written on confirm.
- Implementation: Cursor
- Review/Pushback: I pushed back when title/auditorium existing lists were grabbed from frontend, rather than backend DB. Typo matching now reads `showtimes.movie_title` and `auditoriums.name` from the database. I hardened the title/auditorium matching after seeing `Auditorium 1 (Laser)` treated as a new room or as an auditorium change, when it shouldn't have. A parenthetical note matches the shorter stored room, and that longer name is not inserted.

## 2. Testing

Start from the Downtown rows in `sample-data/existing.csv`. Upload these files and read the preview before confirming.

| File | What it changes | Expected preview |
| --- | --- | --- |
| `sample-data/title-typos.csv` | `Spiderman Homecoming`, `Inside   Out  2`, `DUNE PART 2` | No changes. Those titles are the stored showings. |
| `sample-data/auditorium-typos.csv` | `Aud 1`, `Aud2`, `Auditorium 1 (Laser)`, `Aud1`, `Aud 3` | No changes. Rooms stay Auditorium 1, 2, 1, 1, and 3. No new auditorium row. |
| `sample-data/new-room.csv` | Adds Kung Fu Panda 4 at 18:30 in Auditorium 9 | One add. `auditoriums` gains Auditorium 9. The other six showings stay. |
| `sample-data/new-drop.csv` | The original messy drop, including an IMAX format change | Kung Fu Panda 4 is an add. The 20:00 Dune showing updates format from 2D to IMAX. Wonka and Oppenheimer archive. Spider-Man, Inside Out, and the 22:45 Dune showing are recognized and omitted. |

A missed typo shows up as an add plus an archive of the stored showing. That is the check that the sanitizer failed.

## 3. Next steps

- Decide whether showing uploads can create new, unseen-before, auditoriums/movies. Currently I allow new auditoriums/movies because the new-drop.csv adds movies, but restricting users to the pre-defined movies / auditoriums list would help prevent adding major typos.
- Investigate 10-20 sec latency on Import CSV feature, likely due to LLM API free tier.
- I wanted backend to be deployed seperately, which can be a better design for scaling later on. Cursor suggested the API/UI as one deployable unit in Vercel
- Move search, filters, and sort to the showtimes query, with paging, so the table is not limited to what the browser holds.
- Show typo-corrected showings to give user feedback on why their different title/auditorium was matched to existing value. Model to provide one-sentence reason on each preview row.
- Insert a new auditorium only when confirm is accepted, so cancel does not leave an unused room.
- Add automated tests around `matchKnownName` and these CSV files.
