# AHLink Express OS

The independent operating system for AHLink Express. This first working slice supports:

- customer and walk-in parcel bookings;
- pickup-request bookings with rider dispatch to origin office;
- estimated pricing before AHLink receives a parcel;
- physical package acceptance with verified measurements;
- automatic tracking numbers;
- package placement in an office storage location;
- vehicle registration;
- trip planning;
- manifest building from stored packages;
- package loading control;
- departure confirmation that moves loaded packages into transit;
- destination trip reception with arrived/missing/damaged/wrong-destination checks;
- destination shelf/bin storage;
- collection verification with pickup PIN, receiver details, ID note and signature/photo placeholders;
- exception control for missing, damaged, wrong destination, refused collection and return-to-origin;
- finance controls for sender-paid, recipient-pays and account payments with daily cashier totals;
- staff login with roles and office sessions;
- admin settings for staff, offices, routes and PIN reset;
- pickup dispatch control for rider assignment, sender pickup proof and office handover;
- office-based dashboard filtering;
- action ownership through the active staff session;
- customer notification templates;
- printable labels, receipts and trip manifests;
- real QR labels and scan-based loading/reception/tracking;
- immutable custody events and parcel tracking;
- operational audit trail for admin and auditor roles;
- cashier shifts, daily cash closing, payment method totals and cashier reports;
- Neon/PostgreSQL persistence;
- office dashboard counts.

## Run with Neon/PostgreSQL

AHLink Express OS is now configured to use Neon/PostgreSQL as the normal database. The app will not start unless `DATABASE_URL` is set.

From Command Prompt:

```cmd
cd /d C:\Users\USER\Desktop\AHLink_intelligence_graphs_premium\ahlink-express-os
set DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=verify-full
start-ahlink-express-os.cmd
```

Open `http://127.0.0.1:6062`.

Demo staff users all use PIN `1234`:

- `admin`
- `origin`
- `destination`
- `cashier`
- `manifest`
- `auditor`

You can also copy the template:

```cmd
copy neon-env.example.cmd neon-env.cmd
notepad neon-env.cmd
neon-env.cmd
start-ahlink-express-os.cmd
```

Keep `neon-env.cmd` private because it contains your Neon password.

In Neon, copy the real connection string from your project dashboard. It should look similar to this, but with your real user, password, host and database name:

```cmd
set DATABASE_URL=postgresql://neondb_owner:REAL_PASSWORD@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=verify-full
```

The app will create and use the `app_state` table automatically. The broader production PostgreSQL design is in `database/schema.sql`.

Deployment guidance is in `DEPLOYMENT.md`.

For automated tests only, the app still uses an in-memory test database. A local JSON fallback exists only if `ALLOW_LOCAL_JSON=true` is deliberately set for emergency development.

## Test

```cmd
npm.cmd test
```

## First-release boundary

The current build establishes booking, physical acceptance, origin-office storage, vehicle/trip planning, manifests, package loading, departure, destination reception, destination storage, collection verification, exceptions and finance cashier reporting.
