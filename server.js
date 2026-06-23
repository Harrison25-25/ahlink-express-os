import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOOKING_STATUSES,
  MANIFEST_STATUSES,
  OFFICES,
  PACKAGE_STATUSES,
  TRIP_STATUSES,
  USER_ROLES,
  acceptPhysicalPackage,
  addPackageToManifest,
  assignPickupTask,
  confirmPickupArrivedAtOffice,
  confirmPickupCollected,
  createBooking,
  createFinanceSummary,
  createOrUpdateCustomerAccount,
  createOrUpdateOffice,
  createOrUpdateRoute,
  createOrUpdateStaffUser,
  createTrip,
  createVehicle,
  collectPackage,
  closeCashierShift,
  departTrip,
  dispatchPickupTask,
  ensurePickupTask,
  failOrReschedulePickup,
  markPickupOnTheWay,
  markManifestLoaded,
  receiveTripAtDestination,
  recordAccountPayment,
  recordException,
  recordPayment,
  startCashierShift,
  storeAtDestination,
  storePackage,
  updateStaffPin
} from "./src/domain.js";
import { JsonStore } from "./src/store.js";
import { PostgresStateStore } from "./src/postgres-store.js";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(rootDirectory, "public");
let store;
try {
  store = createConfiguredStore();
} catch (error) {
  if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.error(error.message);
    console.error("Get the real connection string from Neon: Project > Dashboard > Connection string.");
    process.exit(1);
  }
  throw error;
}
const port = Number(process.env.PORT || 6060);
const sessions = new Map();

if (store && typeof store.ready === "function") {
  await store.ready();
}

if (store) {
  await store.transaction((database) => {
    normalizeDatabase(database);
  });
}

const ROLE_ACCESS = {
  ADMIN: ["dashboard", "bookings", "pickup", "acceptance", "inventory", "trips", "destination", "exceptions", "finance", "accounts", "notifications", "admin", "audit", "tracking"],
  ORIGIN_OFFICER: ["dashboard", "bookings", "pickup", "acceptance", "inventory", "trips", "notifications", "tracking"],
  DESTINATION_OFFICER: ["dashboard", "inventory", "destination", "exceptions", "notifications", "tracking"],
  CASHIER: ["dashboard", "finance", "accounts", "notifications", "tracking"],
  MANIFEST_OFFICER: ["dashboard", "pickup", "inventory", "trips", "notifications", "tracking"],
  RIDER: ["dashboard", "pickup", "tracking"],
  VIEWER_AUDITOR: ["dashboard", "inventory", "exceptions", "finance", "accounts", "notifications", "audit", "tracking"]
};

export function createServer(dataStore = store) {
  if (!dataStore) {
    throw new Error("DATABASE_URL is required. AHLink Express OS is configured to use Neon/PostgreSQL.");
  }
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readJson(request);
        const database = normalizeDatabase(await dataStore.read());
        const user = database.users.find((item) => item.userId.toLowerCase() === String(body.userId || "").trim().toLowerCase() && item.pin === String(body.pin || "") && item.isActive !== false);
        if (!user) throw httpError(401, "Invalid staff login.");
        const token = cryptoToken();
        const session = publicUser(user);
        sessions.set(token, session);
        return sendJson(response, 200, { token, session });
      }

      if (request.method === "GET" && url.pathname === "/api/bootstrap") {
        const database = normalizeDatabase(await dataStore.read());
        const session = sessionFromRequest(request, database);
        const office = url.searchParams.get("office") || (session ? session.office : "ALL");
        const filtered = filterDatabaseByOffice(database, office);
        return sendJson(response, 200, {
          offices: database.officeSettings.filter((item) => item.isActive !== false),
          companySettings: database.companySettings || {},
          session,
          allowedViews: session ? ROLE_ACCESS[session.role] || [] : ["dashboard", "tracking"],
          roles: Object.values(USER_ROLES),
          users: session && session.role === "ADMIN" ? database.users.map(publicUser) : [],
          customerAccounts: database.customerAccounts || [],
          riders: database.users.filter((user) => user.isActive !== false && user.role === "RIDER").map(publicUser),
          officeSettings: session && session.role === "ADMIN" ? database.officeSettings : database.officeSettings.filter((item) => item.isActive !== false),
          routeSettings: session && session.role === "ADMIN" ? database.routeSettings : database.routeSettings.filter((item) => item.isActive !== false),
          dashboard: createDashboard(filtered),
          bookings: filtered.bookings.slice().reverse(),
          pickupTasks: filtered.pickupTasks.slice().reverse(),
          packages: filtered.packages.slice().reverse(),
          vehicles: database.vehicles.slice().reverse(),
          trips: filtered.trips.slice().reverse(),
          manifests: database.manifests.slice().reverse(),
          collections: filtered.collections.slice().reverse(),
          exceptions: filtered.exceptions.slice().reverse(),
          payments: filtered.payments.slice().reverse(),
          cashierShifts: filtered.cashierShifts ? filtered.cashierShifts.slice().reverse() : database.cashierShifts.slice().reverse(),
          cashClosings: filtered.cashClosings ? filtered.cashClosings.slice().reverse() : database.cashClosings.slice().reverse(),
          finance: createFinanceSummary(filtered),
          auditLogs: session && ["ADMIN", "VIEWER_AUDITOR"].includes(session.role) ? (database.auditLogs || []).slice().reverse().slice(0, 250) : []
        });
      }

      if (request.method === "POST" && url.pathname === "/api/admin/users") {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requireAdmin(request, database);
          const existingIndex = database.users.findIndex((user) => user.userId === String(body.userId || "").toLowerCase());
          const user = createOrUpdateStaffUser(existingIndex >= 0 ? database.users[existingIndex] : null, body);
          if (database.users.some((row, index) => row.userId === user.userId && index !== existingIndex)) throw httpError(409, "Staff user ID already exists.");
          if (existingIndex >= 0) database.users[existingIndex] = user;
          else database.users.push(user);
          recordAudit(database, request, existingIndex >= 0 ? "STAFF_USER_UPDATED" : "STAFF_USER_CREATED", { userId: user.userId, role: user.role, office: user.office });
          return publicUser(user);
        });
        return sendJson(response, 200, { user: result });
      }

      const userDeactivateMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/deactivate$/);
      if (request.method === "POST" && userDeactivateMatch) {
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requireAdmin(request, database);
          const user = database.users.find((item) => item.userId === userDeactivateMatch[1]);
          if (!user) throw httpError(404, "Staff user not found.");
          user.isActive = false;
          user.updatedAt = new Date().toISOString();
          recordAudit(database, request, "STAFF_USER_DEACTIVATED", { userId: user.userId });
          return publicUser(user);
        });
        return sendJson(response, 200, { user: result });
      }

      const userReactivateMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reactivate$/);
      if (request.method === "POST" && userReactivateMatch) {
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requireAdmin(request, database);
          const user = database.users.find((item) => item.userId === userReactivateMatch[1]);
          if (!user) throw httpError(404, "Staff user not found.");
          user.isActive = true;
          user.updatedAt = new Date().toISOString();
          recordAudit(database, request, "STAFF_USER_REACTIVATED", { userId: user.userId });
          return publicUser(user);
        });
        return sendJson(response, 200, { user: result });
      }

      const userPinMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/pin$/);
      if (request.method === "POST" && userPinMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requireAdmin(request, database);
          const index = database.users.findIndex((item) => item.userId === userPinMatch[1]);
          if (index < 0) throw httpError(404, "Staff user not found.");
          database.users[index] = updateStaffPin(database.users[index], body);
          recordAudit(database, request, "STAFF_PIN_RESET", { userId: database.users[index].userId });
          return publicUser(database.users[index]);
        });
        return sendJson(response, 200, { user: result });
      }

      if (request.method === "POST" && url.pathname === "/api/admin/offices") {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requireAdmin(request, database);
          const code = String(body.code || "").toUpperCase();
          const existingIndex = database.officeSettings.findIndex((office) => office.code === code);
          const office = createOrUpdateOffice(existingIndex >= 0 ? database.officeSettings[existingIndex] : null, body);
          if (existingIndex >= 0) database.officeSettings[existingIndex] = office;
          else database.officeSettings.push(office);
          recordAudit(database, request, "OFFICE_SETTING_SAVED", { code: office.code, name: office.name, isActive: office.isActive });
          return office;
        });
        return sendJson(response, 200, { office: result });
      }

      if (request.method === "POST" && url.pathname === "/api/admin/routes") {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requireAdmin(request, database);
          const routeId = `${String(body.origin || "").toUpperCase()}-${String(body.destination || "").toUpperCase()}`;
          const existingIndex = database.routeSettings.findIndex((route) => route.routeId === routeId);
          const route = createOrUpdateRoute(existingIndex >= 0 ? database.routeSettings[existingIndex] : null, body);
          if (existingIndex >= 0) database.routeSettings[existingIndex] = route;
          else database.routeSettings.push(route);
          recordAudit(database, request, "ROUTE_SETTING_SAVED", { routeId: route.routeId, basePriceCfa: route.basePriceCfa, isActive: route.isActive });
          return route;
        });
        return sendJson(response, 200, { route: result });
      }

      if (request.method === "POST" && url.pathname === "/api/admin/company") {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requireAdmin(request, database);
          database.companySettings = {
            ...(database.companySettings || {}),
            companyName: String(body.companyName || "AHLink Express").trim(),
            phone: String(body.phone || "").trim(),
            receiptFooter: String(body.receiptFooter || "").trim(),
            trackingBaseUrl: String(body.trackingBaseUrl || "").trim()
          };
          recordAudit(database, request, "COMPANY_SETTINGS_UPDATED", { companyName: database.companySettings.companyName });
          return database.companySettings;
        });
        return sendJson(response, 200, { companySettings: result });
      }

      if (request.method === "POST" && url.pathname === "/api/customers") {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requireAdmin(request, database);
          const existingIndex = database.customerAccounts.findIndex((account) =>
            account.accountId === body.accountId || account.accountCode === String(body.accountCode || "").trim().toUpperCase()
          );
          const account = createOrUpdateCustomerAccount(existingIndex >= 0 ? database.customerAccounts[existingIndex] : null, body);
          if (existingIndex >= 0) database.customerAccounts[existingIndex] = account;
          else database.customerAccounts.push(account);
          recordAudit(database, request, existingIndex >= 0 ? "CUSTOMER_ACCOUNT_UPDATED" : "CUSTOMER_ACCOUNT_CREATED", { accountId: account.accountId, accountCode: account.accountCode, accountName: account.accountName });
          return account;
        });
        return sendJson(response, 200, { account: result });
      }

      const accountPaymentMatch = url.pathname.match(/^\/api\/customers\/([^/]+)\/payments$/);
      if (request.method === "POST" && accountPaymentMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const session = sessionFromRequest(request, database);
          if (!session || !["ADMIN", "CASHIER"].includes(session.role)) throw httpError(403, "Only admin or cashier can record account payments.");
          const account = database.customerAccounts.find((item) => item.accountId === accountPaymentMatch[1]);
          if (!account) throw httpError(404, "Customer account not found.");
          const payment = recordAccountPayment(account, { ...body, receivedBy: actorFromRequest(request, database) });
          database.payments.push(payment);
          recordAudit(database, request, "ACCOUNT_PAYMENT_RECORDED", { accountId: account.accountId, accountCode: account.accountCode, amountCfa: payment.amountCfa });
          return payment;
        });
        return sendJson(response, 201, { payment: result });
      }

      if (request.method === "POST" && url.pathname === "/api/bookings") {
        const body = await readJson(request);
        const booking = createBooking(body);
        await dataStore.transaction((database) => {
          database.bookings.push(booking);
          if (booking.receivingMethod === "PICKUP") {
            const pickupTask = ensurePickupTask(booking);
            database.pickupTasks.push(pickupTask);
            recordAudit(database, request, "PICKUP_REQUEST_CREATED", { bookingId: booking.bookingId, bookingCode: booking.bookingCode, pickupTaskId: pickupTask.pickupTaskId });
          }
          recordAudit(database, request, "BOOKING_CREATED", { bookingId: booking.bookingId, bookingCode: booking.bookingCode, route: `${booking.origin}-${booking.destination}` });
        });
        return sendJson(response, 201, { booking });
      }

      const acceptanceMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/accept$/);
      if (request.method === "POST" && acceptanceMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          const booking = database.bookings.find((item) => item.bookingId === acceptanceMatch[1]);
          if (!booking) throw httpError(404, "Booking not found.");
          let customerAccount = null;
          if (body.paymentArrangement === "ACCOUNT") {
            customerAccount = database.customerAccounts.find((account) => account.accountId === body.customerAccountId);
            if (!customerAccount) throw httpError(404, "Select a valid customer/business account for account billing.");
            if (customerAccount.status === "BLOCKED") throw httpError(409, "This customer account is blocked.");
          }
          database.meta.packageSequence += 1;
          const accepted = acceptPhysicalPackage(booking, { ...body, customerAccountId: customerAccount?.accountId || "", accountName: customerAccount?.accountName || "" }, database.meta.packageSequence);
          database.packages.push(accepted.parcelPackage);
          database.events.push(accepted.event);
          booking.status = BOOKING_STATUSES.ACCEPTED;
          booking.acceptedPackageId = accepted.parcelPackage.packageId;
          booking.updatedAt = new Date().toISOString();
          recordAudit(database, request, "PACKAGE_ACCEPTED", { bookingId: booking.bookingId, packageId: accepted.parcelPackage.packageId, trackingNumber: accepted.parcelPackage.trackingNumber });
          return accepted;
        });
        return sendJson(response, 201, result);
      }

      const pickupAssignMatch = url.pathname.match(/^\/api\/pickups\/([^/]+)\/assign$/);
      if (request.method === "POST" && pickupAssignMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requirePickupOperator(request, database);
          const pickupIndex = database.pickupTasks.findIndex((item) => item.pickupTaskId === pickupAssignMatch[1]);
          if (pickupIndex < 0) throw httpError(404, "Pickup task not found.");
          const rider = database.users.find((user) => user.userId === body.riderUserId && user.role === "RIDER" && user.isActive !== false);
          if (!rider) throw httpError(404, "Active rider not found.");
          const assigned = assignPickupTask(database.pickupTasks[pickupIndex], {
            riderUserId: rider.userId,
            riderName: rider.name,
            riderPhone: rider.phone || body.riderPhone || "",
            assignedBy: actorFromRequest(request, database)
          });
          database.pickupTasks[pickupIndex] = assigned;
          updateBookingForPickup(database, assigned.bookingId, { status: "PICKUP_ASSIGNED", riderName: assigned.riderName });
          recordAudit(database, request, "PICKUP_ASSIGNED", { pickupTaskId: assigned.pickupTaskId, riderUserId: rider.userId, bookingCode: assigned.bookingCode });
          return assigned;
        });
        return sendJson(response, 200, { pickupTask: result });
      }

      const pickupDispatchMatch = url.pathname.match(/^\/api\/pickups\/([^/]+)\/dispatch$/);
      if (request.method === "POST" && pickupDispatchMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requirePickupOperator(request, database);
          const pickupIndex = database.pickupTasks.findIndex((item) => item.pickupTaskId === pickupDispatchMatch[1]);
          if (pickupIndex < 0) throw httpError(404, "Pickup task not found.");
          const dispatched = dispatchPickupTask(database.pickupTasks[pickupIndex], body);
          database.pickupTasks[pickupIndex] = dispatched;
          updateBookingForPickup(database, dispatched.bookingId, { status: "PICKUP_DISPATCHED" });
          recordAudit(database, request, "PICKUP_RIDER_DISPATCHED", { pickupTaskId: dispatched.pickupTaskId, riderName: dispatched.riderName, bookingCode: dispatched.bookingCode });
          return dispatched;
        });
        return sendJson(response, 200, { pickupTask: result });
      }

      const pickupOnWayMatch = url.pathname.match(/^\/api\/pickups\/([^/]+)\/on-way$/);
      if (request.method === "POST" && pickupOnWayMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requirePickupOperator(request, database);
          const pickupIndex = database.pickupTasks.findIndex((item) => item.pickupTaskId === pickupOnWayMatch[1]);
          if (pickupIndex < 0) throw httpError(404, "Pickup task not found.");
          const onWay = markPickupOnTheWay(database.pickupTasks[pickupIndex], body);
          database.pickupTasks[pickupIndex] = onWay;
          updateBookingForPickup(database, onWay.bookingId, { status: "PICKUP_DISPATCHED" });
          recordAudit(database, request, "PICKUP_RIDER_ON_THE_WAY", { pickupTaskId: onWay.pickupTaskId, riderName: onWay.riderName, bookingCode: onWay.bookingCode });
          return onWay;
        });
        return sendJson(response, 200, { pickupTask: result });
      }

      const pickupExceptionMatch = url.pathname.match(/^\/api\/pickups\/([^/]+)\/exception$/);
      if (request.method === "POST" && pickupExceptionMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requirePickupOperator(request, database);
          const pickupIndex = database.pickupTasks.findIndex((item) => item.pickupTaskId === pickupExceptionMatch[1]);
          if (pickupIndex < 0) throw httpError(404, "Pickup task not found.");
          const updated = failOrReschedulePickup(database.pickupTasks[pickupIndex], body);
          database.pickupTasks[pickupIndex] = updated;
          updateBookingForPickup(database, updated.bookingId, { status: "PICKUP_REQUESTED" });
          recordAudit(database, request, `PICKUP_${updated.status}`, { pickupTaskId: updated.pickupTaskId, bookingCode: updated.bookingCode, reason: updated.failureReason });
          return updated;
        });
        return sendJson(response, 200, { pickupTask: result });
      }

      const pickupCollectedMatch = url.pathname.match(/^\/api\/pickups\/([^/]+)\/collected$/);
      if (request.method === "POST" && pickupCollectedMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requirePickupOperator(request, database);
          const pickupIndex = database.pickupTasks.findIndex((item) => item.pickupTaskId === pickupCollectedMatch[1]);
          if (pickupIndex < 0) throw httpError(404, "Pickup task not found.");
          const pickedUp = confirmPickupCollected(database.pickupTasks[pickupIndex], body);
          database.pickupTasks[pickupIndex] = pickedUp;
          updateBookingForPickup(database, pickedUp.bookingId, { status: "PICKED_UP_BY_RIDER" });
          recordAudit(database, request, "PICKUP_COLLECTED_BY_RIDER", { pickupTaskId: pickedUp.pickupTaskId, riderName: pickedUp.riderName, bookingCode: pickedUp.bookingCode });
          return pickedUp;
        });
        return sendJson(response, 200, { pickupTask: result });
      }

      const pickupArriveMatch = url.pathname.match(/^\/api\/pickups\/([^/]+)\/arrive-office$/);
      if (request.method === "POST" && pickupArriveMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          requirePickupOperator(request, database);
          const pickupIndex = database.pickupTasks.findIndex((item) => item.pickupTaskId === pickupArriveMatch[1]);
          if (pickupIndex < 0) throw httpError(404, "Pickup task not found.");
          const arrived = confirmPickupArrivedAtOffice(database.pickupTasks[pickupIndex], body);
          database.pickupTasks[pickupIndex] = arrived;
          updateBookingForPickup(database, arrived.bookingId, { status: "PICKUP_ARRIVED_AT_OFFICE" });
          recordAudit(database, request, "PICKUP_ARRIVED_AT_OFFICE", { pickupTaskId: arrived.pickupTaskId, riderName: arrived.riderName, bookingCode: arrived.bookingCode });
          return arrived;
        });
        return sendJson(response, 200, { pickupTask: result });
      }

      const storageMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/store$/);
      if (request.method === "POST" && storageMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          const index = database.packages.findIndex((item) => item.packageId === storageMatch[1]);
          if (index < 0) throw httpError(404, "Package not found.");
          const stored = storePackage(database.packages[index], body);
          database.packages[index] = stored.updatedPackage;
          database.events.push(stored.event);
          recordAudit(database, request, "PACKAGE_STORED_AT_ORIGIN", { packageId: stored.updatedPackage.packageId, trackingNumber: stored.updatedPackage.trackingNumber, storageLocation: stored.updatedPackage.storageLocation });
          return stored;
        });
        return sendJson(response, 200, result);
      }

      const trackingMatch = url.pathname.match(/^\/api\/tracking\/([^/]+)$/);
      if (request.method === "GET" && trackingMatch) {
        const trackingNumber = parseScanCode(decodeURIComponent(trackingMatch[1]));
        const database = await dataStore.read();
        const parcelPackage = database.packages.find((item) => item.trackingNumber === trackingNumber);
        if (!parcelPackage) throw httpError(404, "Tracking number not found.");
        const events = database.events
          .filter((event) => event.packageId === parcelPackage.packageId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return sendJson(response, 200, { package: parcelPackage, events });
      }

      const publicTrackingMatch = url.pathname.match(/^\/api\/public\/tracking\/([^/]+)$/);
      if (request.method === "GET" && publicTrackingMatch) {
        const trackingNumber = parseScanCode(decodeURIComponent(publicTrackingMatch[1]));
        const database = normalizeDatabase(await dataStore.read());
        const parcelPackage = database.packages.find((item) => item.trackingNumber === trackingNumber);
        if (!parcelPackage) throw httpError(404, "Tracking number not found.");
        const events = database.events
          .filter((event) => event.packageId === parcelPackage.packageId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((event) => ({
            type: event.type,
            status: event.newStatus,
            office: event.office,
            note: publicEventNote(event),
            createdAt: event.createdAt
          }));
        return sendJson(response, 200, {
          package: {
            trackingNumber: parcelPackage.trackingNumber,
            origin: parcelPackage.origin,
            destination: parcelPackage.destination,
            recipientName: parcelPackage.recipientName,
            status: parcelPackage.status,
            currentOffice: parcelPackage.currentOffice,
            pickupReady: ["ARRIVED_AT_DESTINATION", "STORED_AT_DESTINATION"].includes(parcelPackage.status),
            collectedAt: parcelPackage.collectedAt || null
          },
          events
        });
      }

      const qrMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/qr\.svg$/);
      if (request.method === "GET" && qrMatch) {
        const database = await dataStore.read();
        const parcelPackage = database.packages.find((item) => item.packageId === qrMatch[1]);
        if (!parcelPackage) throw httpError(404, "Package not found.");
        const { default: QRCode } = await import("qrcode");
        const svg = await QRCode.toString(qrPayload(parcelPackage), { type: "svg", margin: 1, width: 180 });
        response.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" });
        response.end(svg);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/scan/package") {
        const body = await readJson(request);
        const trackingNumber = parseScanCode(body.scan || body.trackingNumber);
        const database = normalizeDatabase(await dataStore.read());
        const parcelPackage = database.packages.find((item) => item.trackingNumber === trackingNumber);
        if (!parcelPackage) throw httpError(404, "Scanned package was not found.");
        return sendJson(response, 200, { package: parcelPackage });
      }

      if (request.method === "POST" && url.pathname === "/api/vehicles") {
        const body = await readJson(request);
        const vehicle = createVehicle(body);
        await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const existingIndex = database.vehicles.findIndex((item) => item.registrationNumber === vehicle.registrationNumber);
          if (existingIndex >= 0) database.vehicles[existingIndex] = { ...vehicle, vehicleId: database.vehicles[existingIndex].vehicleId, createdAt: database.vehicles[existingIndex].createdAt };
          else database.vehicles.push(vehicle);
          recordAudit(database, request, "VEHICLE_SAVED", { vehicleId: vehicle.vehicleId, registrationNumber: vehicle.registrationNumber });
        });
        return sendJson(response, 201, { vehicle });
      }

      if (request.method === "POST" && url.pathname === "/api/trips") {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const vehicle = database.vehicles.find((item) => item.vehicleId === body.vehicleId);
          if (!vehicle) throw httpError(404, "Vehicle not found.");
          const trip = createTrip({
            ...body,
            driverName: body.driverName || vehicle.driverName,
            driverPhone: body.driverPhone || vehicle.driverPhone
          });
          database.trips.push(trip);
          recordAudit(database, request, "TRIP_CREATED", { tripId: trip.tripId, tripCode: trip.tripCode, route: `${trip.origin}-${trip.destination}` });
          return trip;
        });
        return sendJson(response, 201, { trip: result });
      }

      const manifestAddMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/manifest$/);
      if (request.method === "POST" && manifestAddMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const trip = findTrip(database, manifestAddMatch[1]);
          const parcelPackage = findPackage(database, body.packageId);
          if (database.manifests.some((item) => item.tripId === trip.tripId && item.packageId === parcelPackage.packageId && item.status !== MANIFEST_STATUSES.REMOVED)) {
            throw httpError(409, "This package is already on the trip manifest.");
          }
          if (database.manifests.some((item) => item.packageId === parcelPackage.packageId && item.status !== MANIFEST_STATUSES.REMOVED)) {
            throw httpError(409, "This package is already assigned to another active manifest.");
          }
          const manifestItem = addPackageToManifest(trip, parcelPackage, body);
          database.manifests.push(manifestItem);
          if (trip.status === TRIP_STATUSES.PLANNED) trip.status = TRIP_STATUSES.LOADING;
          trip.updatedAt = new Date().toISOString();
          recordAudit(database, request, "MANIFEST_ITEM_ADDED", { tripId: trip.tripId, packageId: parcelPackage.packageId, trackingNumber: parcelPackage.trackingNumber });
          return manifestItem;
        });
        return sendJson(response, 201, { manifestItem: result });
      }

      const manifestLoadMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/manifest\/([^/]+)\/load$/);
      if (request.method === "POST" && manifestLoadMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const trip = findTrip(database, manifestLoadMatch[1]);
          if (![TRIP_STATUSES.PLANNED, TRIP_STATUSES.LOADING].includes(trip.status)) throw httpError(400, "This trip is no longer loading.");
          const index = database.manifests.findIndex((item) => item.manifestItemId === manifestLoadMatch[2] && item.tripId === trip.tripId);
          if (index < 0) throw httpError(404, "Manifest item not found.");
          const manifestItem = database.manifests[index];
          const packageIndex = database.packages.findIndex((item) => item.packageId === manifestItem.packageId);
          if (packageIndex < 0) throw httpError(404, "Package not found.");
          const loaded = markManifestLoaded(manifestItem, database.packages[packageIndex], body);
          database.manifests[index] = loaded.manifestItem;
          database.packages[packageIndex] = loaded.parcelPackage;
          database.events.push(loaded.event);
          recordAudit(database, request, "MANIFEST_ITEM_LOADED", { tripId: trip.tripId, packageId: loaded.parcelPackage.packageId, trackingNumber: loaded.parcelPackage.trackingNumber });
          return loaded.manifestItem;
        });
        return sendJson(response, 200, { manifestItem: result });
      }

      const manifestScanLoadMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/manifest\/load-scan$/);
      if (request.method === "POST" && manifestScanLoadMatch) {
        const body = await readJson(request);
        const trackingNumber = parseScanCode(body.scan || body.trackingNumber);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const trip = findTrip(database, manifestScanLoadMatch[1]);
          if (![TRIP_STATUSES.PLANNED, TRIP_STATUSES.LOADING].includes(trip.status)) throw httpError(400, "This trip is no longer loading.");
          const index = database.manifests.findIndex((item) => item.tripId === trip.tripId && item.trackingNumber === trackingNumber && item.status !== MANIFEST_STATUSES.REMOVED);
          if (index < 0) throw httpError(404, "Scanned package is not on this trip manifest.");
          const manifestItem = database.manifests[index];
          const packageIndex = database.packages.findIndex((item) => item.packageId === manifestItem.packageId);
          if (packageIndex < 0) throw httpError(404, "Package not found.");
          const loaded = markManifestLoaded(manifestItem, database.packages[packageIndex], { actor: body.actor || actorFromRequest(request, database) });
          database.manifests[index] = loaded.manifestItem;
          database.packages[packageIndex] = loaded.parcelPackage;
          database.events.push(loaded.event);
          recordAudit(database, request, "MANIFEST_ITEM_LOADED_BY_SCAN", { tripId: trip.tripId, trackingNumber });
          return loaded.manifestItem;
        });
        return sendJson(response, 200, { manifestItem: result });
      }

      const departMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/depart$/);
      if (request.method === "POST" && departMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const tripIndex = database.trips.findIndex((item) => item.tripId === departMatch[1]);
          if (tripIndex < 0) throw httpError(404, "Trip not found.");
          const trip = database.trips[tripIndex];
          const manifestItems = database.manifests.filter((item) => item.tripId === trip.tripId);
          const departed = departTrip(trip, manifestItems, database.packages, body);
          database.trips[tripIndex] = departed.trip;
          for (const updatedPackage of departed.packages) {
            const packageIndex = database.packages.findIndex((item) => item.packageId === updatedPackage.packageId);
            if (packageIndex >= 0) database.packages[packageIndex] = updatedPackage;
          }
          database.events.push(...departed.events);
          recordAudit(database, request, "TRIP_DEPARTED", { tripId: departed.trip.tripId, tripCode: departed.trip.tripCode, manifestCount: manifestItems.length });
          return departed.trip;
        });
        return sendJson(response, 200, { trip: result });
      }

      const receiveMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/receive$/);
      if (request.method === "POST" && receiveMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const tripIndex = database.trips.findIndex((item) => item.tripId === receiveMatch[1]);
          if (tripIndex < 0) throw httpError(404, "Trip not found.");
          const trip = database.trips[tripIndex];
          const manifestItems = database.manifests.filter((item) => item.tripId === trip.tripId);
          const received = receiveTripAtDestination(trip, manifestItems, database.packages, body);
          database.trips[tripIndex] = received.trip;
          for (const updatedPackage of received.packages) replaceById(database.packages, "packageId", updatedPackage);
          for (const updatedManifestItem of received.manifestItems) replaceById(database.manifests, "manifestItemId", updatedManifestItem);
          database.events.push(...received.events);
          database.exceptions.push(...received.exceptions);
          recordAudit(database, request, "TRIP_RECEIVED_AT_DESTINATION", { tripId: received.trip.tripId, tripCode: received.trip.tripCode, exceptionCount: received.exceptions.length });
          return received;
        });
        return sendJson(response, 200, { trip: result.trip, exceptions: result.exceptions });
      }

      const receiveScanMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/receive-scan$/);
      if (request.method === "POST" && receiveScanMatch) {
        const body = await readJson(request);
        const trackingNumber = parseScanCode(body.scan || body.trackingNumber);
        const report = String(body.report || "ARRIVED").toUpperCase();
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const trip = findTrip(database, receiveScanMatch[1]);
          if (trip.status !== TRIP_STATUSES.DEPARTED) throw httpError(400, "Only departed trips can be received by scan.");
          const manifestIndex = database.manifests.findIndex((item) => item.tripId === trip.tripId && item.trackingNumber === trackingNumber && item.status !== MANIFEST_STATUSES.REMOVED);
          if (manifestIndex < 0) throw httpError(404, "Scanned package is not on this destination trip.");
          const manifestItem = database.manifests[manifestIndex];
          const packageIndex = database.packages.findIndex((item) => item.packageId === manifestItem.packageId);
          if (packageIndex < 0) throw httpError(404, "Package not found.");
          const parcelPackage = database.packages[packageIndex];
          if (parcelPackage.status !== PACKAGE_STATUSES.IN_TRANSIT) throw httpError(400, "This package is not in transit.");
          const actor = body.actor || actorFromRequest(request, database);
          if (report === "ARRIVED") {
            const pickupPin = String(crypto.randomInt(100000, 1000000));
            database.packages[packageIndex] = { ...parcelPackage, status: PACKAGE_STATUSES.ARRIVED_AT_DESTINATION, currentOffice: trip.destination, pickupPin, updatedAt: new Date().toISOString() };
            database.manifests[manifestIndex] = { ...manifestItem, status: MANIFEST_STATUSES.OFFLOADED, offloadedAt: new Date().toISOString(), offloadedBy: actor, updatedAt: new Date().toISOString() };
            database.events.push(createScanEvent(parcelPackage, "PACKAGE_ARRIVED_DESTINATION_SCAN", PACKAGE_STATUSES.ARRIVED_AT_DESTINATION, actor, trip.destination, `Package received by scan from trip ${trip.tripCode}.`));
          } else {
            const exception = recordException(parcelPackage, { exceptionType: report, actor, office: trip.destination, note: body.note || `Exception recorded by scan during ${trip.tripCode}.` });
            database.packages[packageIndex] = exception.updatedPackage;
            database.exceptions.push(exception.exception);
            database.events.push(exception.event);
          }
          const remainingInTransit = database.manifests
            .filter((item) => item.tripId === trip.tripId && item.status !== MANIFEST_STATUSES.REMOVED)
            .some((item) => {
              const row = database.packages.find((parcel) => parcel.packageId === item.packageId);
              return row && row.status === PACKAGE_STATUSES.IN_TRANSIT;
            });
          if (!remainingInTransit) {
            trip.status = TRIP_STATUSES.ARRIVED;
            trip.arrivedAt = new Date().toISOString();
            trip.receivedBy = actor;
            trip.updatedAt = new Date().toISOString();
          }
          recordAudit(database, request, "DESTINATION_PACKAGE_RECEIVED_BY_SCAN", { tripId: trip.tripId, trackingNumber, report });
          return { trip, package: database.packages[packageIndex] };
        });
        return sendJson(response, 200, result);
      }

      const destinationStoreMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/destination-store$/);
      if (request.method === "POST" && destinationStoreMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const packageIndex = database.packages.findIndex((item) => item.packageId === destinationStoreMatch[1]);
          if (packageIndex < 0) throw httpError(404, "Package not found.");
          const stored = storeAtDestination(database.packages[packageIndex], body);
          database.packages[packageIndex] = stored.updatedPackage;
          database.events.push(stored.event);
          recordAudit(database, request, "PACKAGE_STORED_AT_DESTINATION", { packageId: stored.updatedPackage.packageId, trackingNumber: stored.updatedPackage.trackingNumber, storageLocation: stored.updatedPackage.destinationStorageLocation });
          return stored;
        });
        return sendJson(response, 200, result);
      }

      const collectMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/collect$/);
      if (request.method === "POST" && collectMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const packageIndex = database.packages.findIndex((item) => item.packageId === collectMatch[1]);
          if (packageIndex < 0) throw httpError(404, "Package not found.");
          const collected = collectPackage(database.packages[packageIndex], body);
          database.packages[packageIndex] = collected.updatedPackage;
          database.collections.push(collected.collection);
          database.events.push(collected.event);
          recordAudit(database, request, "PACKAGE_COLLECTED", { packageId: collected.updatedPackage.packageId, trackingNumber: collected.updatedPackage.trackingNumber, receiverName: collected.collection.receiverName });
          return collected;
        });
        return sendJson(response, 200, result);
      }

      const exceptionMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/exception$/);
      if (request.method === "POST" && exceptionMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const packageIndex = database.packages.findIndex((item) => item.packageId === exceptionMatch[1]);
          if (packageIndex < 0) throw httpError(404, "Package not found.");
          const exception = recordException(database.packages[packageIndex], body);
          database.packages[packageIndex] = exception.updatedPackage;
          database.exceptions.push(exception.exception);
          database.events.push(exception.event);
          recordAudit(database, request, "EXCEPTION_RECORDED", { packageId: exception.updatedPackage.packageId, trackingNumber: exception.updatedPackage.trackingNumber, exceptionType: exception.exception.exceptionType });
          return exception;
        });
        return sendJson(response, 200, result);
      }

      const paymentMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/payments$/);
      if (request.method === "POST" && paymentMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const packageIndex = database.packages.findIndex((item) => item.packageId === paymentMatch[1]);
          if (packageIndex < 0) throw httpError(404, "Package not found.");
          const activeShift = findOpenCashierShift(database, request);
          const payment = recordPayment(database.packages[packageIndex], {
            ...body,
            receivedByUserId: sessionFromRequest(request, database)?.userId || "",
            shiftId: activeShift?.shiftId || ""
          });
          database.packages[packageIndex] = payment.updatedPackage;
          database.payments.push(payment.payment);
          database.events.push(payment.event);
          recordAudit(database, request, "PAYMENT_RECORDED", { packageId: payment.updatedPackage.packageId, trackingNumber: payment.updatedPackage.trackingNumber, amountCfa: payment.payment.amountCfa, mode: payment.payment.mode });
          return payment;
        });
        return sendJson(response, 200, result);
      }

      if (request.method === "POST" && url.pathname === "/api/finance/shifts/start") {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const session = sessionFromRequest(request, database);
          if (!session || !["ADMIN", "CASHIER"].includes(session.role)) throw httpError(403, "Only admin or cashier can start a cashier shift.");
          if (database.cashierShifts.some((shift) => shift.cashierUserId === session.userId && shift.status === "OPEN")) throw httpError(409, "This cashier already has an open shift.");
          const shift = startCashierShift({
            cashierUserId: session.userId,
            cashierName: session.name,
            office: session.office,
            openingFloatCfa: body.openingFloatCfa,
            note: body.note
          });
          database.cashierShifts.push(shift);
          recordAudit(database, request, "CASHIER_SHIFT_STARTED", { shiftId: shift.shiftId, openingFloatCfa: shift.openingFloatCfa });
          return shift;
        });
        return sendJson(response, 201, { shift: result });
      }

      const closeShiftMatch = url.pathname.match(/^\/api\/finance\/shifts\/([^/]+)\/close$/);
      if (request.method === "POST" && closeShiftMatch) {
        const body = await readJson(request);
        const result = await dataStore.transaction((database) => {
          normalizeDatabase(database);
          const session = sessionFromRequest(request, database);
          if (!session || !["ADMIN", "CASHIER"].includes(session.role)) throw httpError(403, "Only admin or cashier can close a cashier shift.");
          const shiftIndex = database.cashierShifts.findIndex((shift) => shift.shiftId === closeShiftMatch[1]);
          if (shiftIndex < 0) throw httpError(404, "Cashier shift not found.");
          const shift = database.cashierShifts[shiftIndex];
          if (session.role !== "ADMIN" && shift.cashierUserId !== session.userId) throw httpError(403, "Cashiers can only close their own shift.");
          const closing = closeCashierShift(shift, database.payments, body);
          database.cashierShifts[shiftIndex] = { ...shift, status: "CLOSED", closedAt: closing.closedAt, closingId: closing.closingId };
          database.cashClosings.push(closing);
          recordAudit(database, request, "CASHIER_SHIFT_CLOSED", { shiftId: shift.shiftId, closingId: closing.closingId, varianceCfa: closing.varianceCfa });
          return closing;
        });
        return sendJson(response, 200, { closing: result });
      }

      if (request.method === "GET" && url.pathname === "/api/finance/daily") {
        const database = normalizeDatabase(await dataStore.read());
        return sendJson(response, 200, { summary: createFinanceSummary(database, url.searchParams.get("date")), payments: database.payments.slice().reverse() });
      }

      if (request.method === "GET" && url.pathname === "/api/finance/report.csv") {
        const database = normalizeDatabase(await dataStore.read());
        const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
        const summary = createFinanceSummary(database, date);
        const rows = [
          ["AHLink Express cashier report", date],
          ["Total collected", summary.totalCollectedCfa],
          ["Payment count", summary.paymentCount],
          ["Outstanding", summary.outstandingCfa],
          [],
          ["Payment ID", "Tracking", "Amount", "Mode", "Payer", "Cashier", "Paid at"],
          ...database.payments
            .filter((payment) => String(payment.paidAt || "").slice(0, 10) === date)
            .map((payment) => [payment.paymentId, payment.trackingNumber, payment.amountCfa, payment.mode, payment.payerType, payment.receivedBy, payment.paidAt])
        ];
        const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
        response.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ahlink-finance-${date}.csv"`
        });
        response.end(csv);
        return;
      }

      if (request.method === "GET") return serveStatic(url.pathname, response);
      throw httpError(404, "Route not found.");
    } catch (error) {
      const statusCode = error.statusCode || 400;
      sendJson(response, statusCode, { error: error.message || "Unexpected error." });
    }
  });
}

function createConfiguredStore() {
  if (process.env.DATABASE_URL) return new PostgresStateStore(process.env.DATABASE_URL);
  if (process.env.ALLOW_LOCAL_JSON === "true") return new JsonStore(path.join(rootDirectory, "data", "db.json"));
  return null;
}

function createDashboard(database) {
  return {
    awaitingParcel: database.bookings.filter((booking) =>
      [BOOKING_STATUSES.AWAITING_DROPOFF, BOOKING_STATUSES.PICKUP_REQUESTED].includes(booking.status)
    ).length,
    acceptedToday: database.packages.filter((parcelPackage) => sameLocalDay(parcelPackage.createdAt, new Date())).length,
    storedAtOrigin: database.packages.filter((parcelPackage) => parcelPackage.status === "STORED_AT_ORIGIN").length,
    readyForManifest: database.packages.filter((parcelPackage) => parcelPackage.status === PACKAGE_STATUSES.STORED_AT_ORIGIN).length,
    activeTrips: database.trips.filter((trip) => ![TRIP_STATUSES.ARRIVED, TRIP_STATUSES.CANCELLED].includes(trip.status)).length,
    loadedPackages: database.manifests.filter((item) => item.status === MANIFEST_STATUSES.LOADED).length,
    totalPackages: database.packages.length
  };
}

function normalizeDatabase(database) {
  database.meta ||= { packageSequence: 0 };
  database.companySettings ||= {
    companyName: "AHLink Express",
    phone: "",
    receiptFooter: "Thank you for using AHLink Express.",
    trackingBaseUrl: ""
  };
  database.officeSettings ||= OFFICES.map((office) => ({ ...office, isActive: true }));
  database.routeSettings ||= [
    { routeId: "BUE-LIM", origin: "BUE", destination: "LIM", name: "Buea to Limbe", basePriceCfa: 1500, isActive: true },
    { routeId: "LIM-BUE", origin: "LIM", destination: "BUE", name: "Limbe to Buea", basePriceCfa: 1500, isActive: true },
    { routeId: "BUE-DLA", origin: "BUE", destination: "DLA", name: "Buea to Douala", basePriceCfa: 3000, isActive: true },
    { routeId: "DLA-BUE", origin: "DLA", destination: "BUE", name: "Douala to Buea", basePriceCfa: 3000, isActive: true },
    { routeId: "LIM-DLA", origin: "LIM", destination: "DLA", name: "Limbe to Douala", basePriceCfa: 2500, isActive: true },
    { routeId: "DLA-LIM", origin: "DLA", destination: "LIM", name: "Douala to Limbe", basePriceCfa: 2500, isActive: true }
  ];
  database.users ||= [];
  if (!database.users.length) {
    database.users.push(
      { userId: "admin", name: "Admin User", role: "ADMIN", office: "BUE", pin: "1234", isActive: true },
      { userId: "origin", name: "Origin Officer", role: "ORIGIN_OFFICER", office: "BUE", pin: "1234", isActive: true },
      { userId: "destination", name: "Destination Officer", role: "DESTINATION_OFFICER", office: "DLA", pin: "1234", isActive: true },
      { userId: "cashier", name: "Cashier", role: "CASHIER", office: "DLA", pin: "1234", isActive: true },
      { userId: "manifest", name: "Manifest Officer", role: "MANIFEST_OFFICER", office: "BUE", pin: "1234", isActive: true },
      { userId: "rider", name: "Pickup Rider", role: "RIDER", office: "BUE", pin: "1234", isActive: true },
      { userId: "auditor", name: "Viewer Auditor", role: "VIEWER_AUDITOR", office: "BUE", pin: "1234", isActive: true }
    );
  }
  if (!database.users.some((user) => user.userId === "rider")) {
    database.users.push({ userId: "rider", name: "Pickup Rider", role: "RIDER", office: "BUE", pin: "1234", isActive: true });
  }
  database.bookings ||= [];
  database.customerAccounts ||= [];
  database.pickupTasks ||= [];
  database.packages ||= [];
  database.vehicles ||= [];
  database.trips ||= [];
  database.manifests ||= [];
  database.collections ||= [];
  database.exceptions ||= [];
  database.payments ||= [];
  database.cashierShifts ||= [];
  database.cashClosings ||= [];
  database.events ||= [];
  database.auditLogs ||= [];
  return database;
}

function publicEventNote(event) {
  const type = String(event.type || "");
  if (type.includes("ACCEPTED")) return "Package accepted into AHLink Express custody.";
  if (type.includes("STORED")) return "Package stored safely at an AHLink office.";
  if (type.includes("LOADED")) return "Package loaded for transport.";
  if (type.includes("DEPARTED")) return "Package departed origin office.";
  if (type.includes("ARRIVED")) return "Package arrived at destination office.";
  if (type.includes("COLLECTED")) return "Package collected by receiver.";
  if (type.includes("EXCEPTION")) return "AHLink recorded an exception and will follow up.";
  return event.note || "Tracking update recorded.";
}

function cryptoToken() {
  return crypto.randomBytes(24).toString("hex");
}

function publicUser(user) {
  return { userId: user.userId, name: user.name, role: user.role, office: user.office, isActive: user.isActive !== false };
}

function sessionFromRequest(request, database) {
  const token = request.headers["x-ahlink-session"];
  if (token && sessions.has(token)) return sessions.get(token);
  const fallback = database.users.find((user) => user.role === "ADMIN") || database.users[0];
  return fallback ? publicUser(fallback) : null;
}

function actorFromRequest(request, database) {
  const session = sessionFromRequest(request, database);
  return session ? session.name : "System";
}

function requireAdmin(request, database) {
  const session = sessionFromRequest(request, database);
  if (!session || session.role !== "ADMIN") throw httpError(403, "Admin access is required.");
  return session;
}

function requirePickupOperator(request, database) {
  const session = sessionFromRequest(request, database);
  if (!session || !["ADMIN", "ORIGIN_OFFICER", "MANIFEST_OFFICER", "RIDER"].includes(session.role)) {
    throw httpError(403, "Pickup dispatch access is required.");
  }
  return session;
}

function updateBookingForPickup(database, bookingId, updates) {
  const booking = database.bookings.find((item) => item.bookingId === bookingId);
  if (!booking) throw httpError(404, "Booking not found for pickup task.");
  Object.assign(booking, updates, { updatedAt: new Date().toISOString() });
  return booking;
}

function recordAudit(database, request, action, details = {}) {
  normalizeDatabase(database);
  const session = sessionFromRequest(request, database);
  database.auditLogs.push({
    auditId: crypto.randomUUID(),
    action,
    actorUserId: session?.userId || "system",
    actorName: session?.name || actorFromRequest(request, database),
    role: session?.role || "SYSTEM",
    office: session?.office || details.office || "SYSTEM",
    details,
    createdAt: new Date().toISOString()
  });
}

function parseScanCode(value) {
  const raw = String(value || "").trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed.trackingNumber) return String(parsed.trackingNumber).trim().toUpperCase();
  } catch {}
  if (raw.includes("|")) return raw.split("|").pop().trim().toUpperCase();
  if (raw.startsWith("AHE:")) return raw.slice(4).trim().toUpperCase();
  return raw.toUpperCase();
}

function qrPayload(parcelPackage) {
  return JSON.stringify({
    type: "AHLINK_EXPRESS_PACKAGE",
    trackingNumber: parcelPackage.trackingNumber,
    packageId: parcelPackage.packageId
  });
}

function createScanEvent(parcelPackage, type, newStatus, actor, office, note) {
  return {
    eventId: crypto.randomUUID(),
    packageId: parcelPackage.packageId,
    type,
    previousStatus: parcelPackage.status,
    newStatus,
    actor,
    office,
    note,
    createdAt: new Date().toISOString()
  };
}

function findOpenCashierShift(database, request) {
  const session = sessionFromRequest(request, database);
  if (!session) return null;
  return database.cashierShifts.find((shift) => shift.cashierUserId === session.userId && shift.status === "OPEN") || null;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function filterDatabaseByOffice(database, office) {
  if (!office || office === "ALL") return database;
  const packages = database.packages.filter((item) => item.origin === office || item.destination === office || item.currentOffice === office);
  const packageIds = new Set(packages.map((item) => item.packageId));
  const tripIds = new Set(database.trips.filter((trip) => trip.origin === office || trip.destination === office).map((trip) => trip.tripId));
  return {
    ...database,
    bookings: database.bookings.filter((item) => item.origin === office || item.destination === office),
    pickupTasks: database.pickupTasks.filter((item) => item.origin === office || item.destination === office),
    packages,
    trips: database.trips.filter((trip) => tripIds.has(trip.tripId)),
    manifests: database.manifests.filter((item) => tripIds.has(item.tripId) || packageIds.has(item.packageId)),
    collections: database.collections.filter((item) => packageIds.has(item.packageId)),
    exceptions: database.exceptions.filter((item) => packageIds.has(item.packageId) || item.office === office),
    payments: database.payments.filter((item) => packageIds.has(item.packageId)),
    cashierShifts: database.cashierShifts.filter((item) => item.office === office),
    cashClosings: database.cashClosings.filter((item) => item.office === office)
  };
}

function replaceById(rows, key, updatedRow) {
  const index = rows.findIndex((item) => item[key] === updatedRow[key]);
  if (index >= 0) rows[index] = updatedRow;
}

function findTrip(database, tripId) {
  const trip = database.trips.find((item) => item.tripId === tripId);
  if (!trip) throw httpError(404, "Trip not found.");
  return trip;
}

function findPackage(database, packageId) {
  const parcelPackage = database.packages.find((item) => item.packageId === packageId);
  if (!parcelPackage) throw httpError(404, "Package not found.");
  return parcelPackage;
}

function sameLocalDay(isoDate, date) {
  const candidate = new Date(isoDate);
  return candidate.getFullYear() === date.getFullYear()
    && candidate.getMonth() === date.getMonth()
    && candidate.getDate() === date.getDate();
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw httpError(413, "Request is too large.");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw httpError(400, "Invalid JSON request.");
  }
}

function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : pathname === "/track" ? "/track.html" : pathname;
  const filePath = path.resolve(publicDirectory, `.${requested}`);
  if (!filePath.startsWith(publicDirectory) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    throw httpError(404, "Page not found.");
  }
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
  response.writeHead(200, { "Content-Type": `${types[path.extname(filePath)] || "application/octet-stream"}; charset=utf-8` });
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!store) {
    console.error("AHLink Express OS needs Neon/PostgreSQL before it can start.");
    console.error("Set DATABASE_URL first, for example:");
    console.error("set DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require");
    process.exit(1);
  }
  const host = process.env.HOST || "0.0.0.0";
  createServer().listen(port, host, () => {
    console.log(`AHLink Express OS is running at http://${host}:${port}`);
    console.log("Database: Neon/PostgreSQL");
  });
}
