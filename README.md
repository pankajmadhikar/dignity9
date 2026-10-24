# Dignity Clinic

Outpatient desk for one clinic: registration, vitals, a live queue, consultations, prescriptions, laboratory uploads, follow-ups, and an audit log. A patient can open an expiring link for prescriptions and reports. Follow-up reminders are queued in Redis and sent only when WhatsApp or SMS credentials are configured.

The pilot is a general-physician clinic, English only, Asia/Kolkata, and a single clinic. Billing is not included. Session cookies stay on the server. Medical files stay in private storage and are not cached by the PWA.

## Stack

React, TypeScript, Vite, Tailwind, and shadcn-style components on the desk. Forms use React Hook Form and Zod. Server data uses TanStack Query. The API is Express, PostgreSQL, and Prisma, with Socket.IO for the queue. BullMQ and Redis run reminders. Files use local storage in development and S3-compatible storage when `STORAGE_DRIVER=s3`. API docs are at `/api/docs`.

## Run

PostgreSQL and Redis need to be running locally. `docker compose up` starts both if you do not already have them.

```bash
createdb dignity9
npm install
npm run db:push
npm run db:seed
npm run dev
```

Open http://localhost:5173. `npm run dev` starts the API, the reminder worker, and the web app.

| Role | Email | Password |
|---|---|---|
| Reception | reception@dignity.test | Clinic#2026 |
| Doctor | doctor@dignity.test | Clinic#2026 |
| Laboratory | lab@dignity.test | Clinic#2026 |
| Admin | admin@dignity.test | Clinic#2026 |

`npm run db:seed` wipes the local database and loads the sample clinic. It refuses to run when `NODE_ENV` is production.

## Tests

```bash
createdb dignity9_test
npm test
npx playwright install chromium
npm run test:e2e
```

API tests check duplicate-patient warnings, receptionist access, one active consultation per doctor, and laboratory reports staying on the ordered patient. The web test checks patient-form validation. Playwright signs in as reception and as the doctor against the running app.
