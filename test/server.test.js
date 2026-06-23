import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import { MemoryStore } from "../src/store.js";

async function withServer(callback) {
  const server = createServer(new MemoryStore());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json();
  return { response, body };
}

test("HTTP workflow preserves the booking-to-custody boundary", async () => {
  await withServer(async (baseUrl) => {
    const created = await jsonRequest(`${baseUrl}/api/bookings`, {
      method: "POST",
      body: {
        senderName: "Alice Sender",
        senderPhone: "677000001",
        recipientName: "Bob Recipient",
        recipientPhone: "677000002",
        origin: "BUE",
        destination: "DLA",
        receivingMethod: "DROPOFF",
        service: "STANDARD",
        itemDescription: "Sealed box of clothing",
        approximateWeightKg: 2,
        declaredValueCfa: 25000
      }
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.booking.status, "AWAITING_DROPOFF");

    const beforeAcceptance = await jsonRequest(`${baseUrl}/api/bootstrap`);
    assert.equal(beforeAcceptance.body.dashboard.awaitingParcel, 1);
    assert.equal(beforeAcceptance.body.dashboard.totalPackages, 0);

    const accepted = await jsonRequest(`${baseUrl}/api/bookings/${created.body.booking.bookingId}/accept`, {
      method: "POST",
      body: {
        verifiedWeightKg: 3.4,
        lengthCm: 40,
        widthCm: 30,
        heightCm: 20,
        condition: "GOOD",
        paymentArrangement: "SENDER_PAID",
        sealNumber: "SL-1001",
        acceptedBy: "Miriam"
      }
    });
    assert.equal(accepted.response.status, 201);
    assert.match(accepted.body.parcelPackage.trackingNumber, /^AHE-BUE-DLA-/);
    assert.equal(accepted.body.parcelPackage.status, "ACCEPTED_AT_ORIGIN");

    const stored = await jsonRequest(`${baseUrl}/api/packages/${accepted.body.parcelPackage.packageId}/store`, {
      method: "POST",
      body: { storageLocation: "BUE-DLA-A01", actor: "Peter" }
    });
    assert.equal(stored.response.status, 200);
    assert.equal(stored.body.updatedPackage.status, "STORED_AT_ORIGIN");

    const tracked = await jsonRequest(`${baseUrl}/api/tracking/${accepted.body.parcelPackage.trackingNumber}`);
    assert.equal(tracked.response.status, 200);
    assert.equal(tracked.body.events.length, 2);
    assert.deepEqual(tracked.body.events.map((event) => event.type), ["PACKAGE_ACCEPTED", "PACKAGE_STORED"]);

    const afterStorage = await jsonRequest(`${baseUrl}/api/bootstrap`);
    assert.ok(afterStorage.body.auditLogs.some((row) => row.action === "BOOKING_CREATED"));
    assert.ok(afterStorage.body.auditLogs.some((row) => row.action === "PACKAGE_ACCEPTED"));
    assert.ok(afterStorage.body.auditLogs.some((row) => row.action === "PACKAGE_STORED_AT_ORIGIN"));
  });
});

test("staff login returns role and office session", async () => {
  await withServer(async (baseUrl) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/login`, { method: "POST", body: { userId: "cashier", pin: "1234" } });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.session.role, "CASHIER");
    assert.equal(login.body.session.office, "DLA");
    const bootstrap = await jsonRequest(`${baseUrl}/api/bootstrap?office=DLA`, { headers: { "X-AHLink-Session": login.body.token } });
    assert.equal(bootstrap.response.status, 200);
    assert.ok(bootstrap.body.allowedViews.includes("finance"));
    assert.ok(!bootstrap.body.allowedViews.includes("trips"));
  });
});

test("admin can manage staff settings", async () => {
  await withServer(async (baseUrl) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/login`, { method: "POST", body: { userId: "admin", pin: "1234" } });
    const saved = await jsonRequest(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { userId: "cashier2", name: "Second Cashier", role: "CASHIER", office: "BUE", pin: "2468", isActive: "true" }
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.user.role, "CASHIER");

    const reset = await jsonRequest(`${baseUrl}/api/admin/users/cashier2/pin`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { pin: "1357" }
    });
    assert.equal(reset.response.status, 200);

    const newLogin = await jsonRequest(`${baseUrl}/api/auth/login`, { method: "POST", body: { userId: "cashier2", pin: "1357" } });
    assert.equal(newLogin.response.status, 200);
  });
});

test("pickup requests can be assigned, dispatched, collected and received at office", async () => {
  await withServer(async (baseUrl) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/login`, { method: "POST", body: { userId: "admin", pin: "1234" } });
    const created = await jsonRequest(`${baseUrl}/api/bookings`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: {
        senderName: "Pickup Sender",
        senderPhone: "677000031",
        recipientName: "Pickup Receiver",
        recipientPhone: "677000032",
        origin: "BUE",
        destination: "DLA",
        receivingMethod: "PICKUP",
        pickupAddress: "Molyko, near the pharmacy",
        service: "STANDARD",
        itemDescription: "Pickup parcel",
        approximateWeightKg: 1,
        declaredValueCfa: 0
      }
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.booking.status, "PICKUP_REQUESTED");

    let bootstrap = await jsonRequest(`${baseUrl}/api/bootstrap`, { headers: { "X-AHLink-Session": login.body.token } });
    const task = bootstrap.body.pickupTasks.find((item) => item.bookingId === created.body.booking.bookingId);
    assert.equal(task.status, "REQUESTED");

    const assigned = await jsonRequest(`${baseUrl}/api/pickups/${task.pickupTaskId}/assign`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { riderUserId: "rider" }
    });
    assert.equal(assigned.body.pickupTask.status, "ASSIGNED");

    const dispatched = await jsonRequest(`${baseUrl}/api/pickups/${task.pickupTaskId}/dispatch`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { note: "Dispatch rider now" }
    });
    assert.equal(dispatched.body.pickupTask.status, "DISPATCHED");

    const collected = await jsonRequest(`${baseUrl}/api/pickups/${task.pickupTaskId}/collected`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { pickupProofNote: "Sender confirmed handover to rider." }
    });
    assert.equal(collected.body.pickupTask.status, "PICKED_UP");

    const arrived = await jsonRequest(`${baseUrl}/api/pickups/${task.pickupTaskId}/arrive-office`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { officeArrivalNote: "Parcel received by origin desk." }
    });
    assert.equal(arrived.body.pickupTask.status, "ARRIVED_AT_OFFICE");

    bootstrap = await jsonRequest(`${baseUrl}/api/bootstrap`, { headers: { "X-AHLink-Session": login.body.token } });
    const booking = bootstrap.body.bookings.find((item) => item.bookingId === created.body.booking.bookingId);
    assert.equal(booking.status, "PICKUP_ARRIVED_AT_OFFICE");
  });
});

test("customer accounts support account billing and public tracking", async () => {
  await withServer(async (baseUrl) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/login`, { method: "POST", body: { userId: "admin", pin: "1234" } });
    const account = await jsonRequest(`${baseUrl}/api/customers`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { accountCode: "BIZ-001", accountName: "Buea Market Traders", contactName: "Mrs Trader", phone: "677400001", accountType: "BUSINESS", creditLimitCfa: 50000, status: "ACTIVE" }
    });
    assert.equal(account.response.status, 200);

    const booking = await jsonRequest(`${baseUrl}/api/bookings`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: {
        senderName: "Buea Market Traders",
        senderPhone: "677400001",
        recipientName: "Account Receiver",
        recipientPhone: "677400002",
        origin: "BUE",
        destination: "DLA",
        receivingMethod: "DROPOFF",
        service: "STANDARD",
        itemDescription: "Account billed parcel",
        approximateWeightKg: 1,
        declaredValueCfa: 0,
        customerAccountId: account.body.account.accountId
      }
    });
    const accepted = await jsonRequest(`${baseUrl}/api/bookings/${booking.body.booking.bookingId}/accept`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: {
        verifiedWeightKg: 1,
        lengthCm: 20,
        widthCm: 10,
        heightCm: 5,
        condition: "GOOD",
        paymentArrangement: "ACCOUNT",
        customerAccountId: account.body.account.accountId,
        acceptedBy: "Admin User"
      }
    });
    assert.equal(accepted.response.status, 201);
    assert.equal(accepted.body.parcelPackage.customerAccountId, account.body.account.accountId);
    assert.equal(accepted.body.parcelPackage.paymentStatus, "PENDING");

    const publicTracking = await jsonRequest(`${baseUrl}/api/public/tracking/${accepted.body.parcelPackage.trackingNumber}`);
    assert.equal(publicTracking.response.status, 200);
    assert.equal(publicTracking.body.package.trackingNumber, accepted.body.parcelPackage.trackingNumber);
    assert.equal(publicTracking.body.package.paymentStatus, undefined);

    const payment = await jsonRequest(`${baseUrl}/api/customers/${account.body.account.accountId}/payments`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { amountCfa: 2000, mode: "MOMO", note: "Part account payment" }
    });
    assert.equal(payment.response.status, 201);
  });
});

test("the operations interface is served", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /AHLink Express OS/);
    assert.match(html, /Accept a physical package/);
  });
});

test("HTTP trip manifest workflow loads packages before departure", async () => {
  await withServer(async (baseUrl) => {
    const created = await jsonRequest(`${baseUrl}/api/bookings`, {
      method: "POST",
      body: {
        senderName: "Alice Sender",
        senderPhone: "677000001",
        recipientName: "Bob Recipient",
        recipientPhone: "677000002",
        origin: "BUE",
        destination: "DLA",
        receivingMethod: "DROPOFF",
        service: "STANDARD",
        itemDescription: "Sealed box of clothing",
        approximateWeightKg: 2,
        declaredValueCfa: 25000
      }
    });
    const accepted = await jsonRequest(`${baseUrl}/api/bookings/${created.body.booking.bookingId}/accept`, {
      method: "POST",
      body: {
        verifiedWeightKg: 2,
        lengthCm: 40,
        widthCm: 30,
        heightCm: 20,
        condition: "GOOD",
        paymentArrangement: "SENDER_PAID",
        acceptedBy: "Miriam"
      }
    });
    await jsonRequest(`${baseUrl}/api/packages/${accepted.body.parcelPackage.packageId}/store`, {
      method: "POST",
      body: { storageLocation: "BUE-DLA-A03", actor: "Peter" }
    });
    const vehicle = await jsonRequest(`${baseUrl}/api/vehicles`, {
      method: "POST",
      body: { registrationNumber: "LT-456-AA", vehicleType: "Van", capacityPackages: 30, capacityKg: 500 }
    });
    assert.equal(vehicle.response.status, 201);
    const trip = await jsonRequest(`${baseUrl}/api/trips`, {
      method: "POST",
      body: { tripDate: "2026-06-23", routeName: "Buea to Douala", origin: "BUE", destination: "DLA", vehicleId: vehicle.body.vehicle.vehicleId }
    });
    assert.equal(trip.response.status, 201);
    const manifest = await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/manifest`, {
      method: "POST",
      body: { packageId: accepted.body.parcelPackage.packageId }
    });
    assert.equal(manifest.response.status, 201);

    const blockedDeparture = await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/depart`, {
      method: "POST",
      body: { actor: "Peter" }
    });
    assert.equal(blockedDeparture.response.status, 400);

    const loaded = await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/manifest/${manifest.body.manifestItem.manifestItemId}/load`, {
      method: "POST",
      body: { actor: "Miriam" }
    });
    assert.equal(loaded.response.status, 200);
    assert.equal(loaded.body.manifestItem.status, "LOADED");

    const departed = await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/depart`, {
      method: "POST",
      body: { actor: "Peter" }
    });
    assert.equal(departed.response.status, 200);
    assert.equal(departed.body.trip.status, "DEPARTED");
  });
});

test("QR label and scan loading work for trip manifests", async () => {
  await withServer(async (baseUrl) => {
    const created = await jsonRequest(`${baseUrl}/api/bookings`, { method: "POST", body: { senderName: "Scan Sender", senderPhone: "677000021", recipientName: "Scan Receiver", recipientPhone: "677000022", origin: "BUE", destination: "DLA", receivingMethod: "DROPOFF", service: "STANDARD", itemDescription: "Scannable parcel", approximateWeightKg: 1, declaredValueCfa: 0 } });
    const accepted = await jsonRequest(`${baseUrl}/api/bookings/${created.body.booking.bookingId}/accept`, { method: "POST", body: { verifiedWeightKg: 1, lengthCm: 20, widthCm: 10, heightCm: 2, condition: "GOOD", paymentArrangement: "SENDER_PAID", acceptedBy: "Miriam" } });
    await jsonRequest(`${baseUrl}/api/packages/${accepted.body.parcelPackage.packageId}/store`, { method: "POST", body: { storageLocation: "BUE-DLA-SCAN", actor: "Peter" } });
    const qr = await fetch(`${baseUrl}/api/packages/${accepted.body.parcelPackage.packageId}/qr.svg`);
    assert.equal(qr.status, 200);
    assert.match(await qr.text(), /svg/);
    const vehicle = await jsonRequest(`${baseUrl}/api/vehicles`, { method: "POST", body: { registrationNumber: "SCAN-001", vehicleType: "Van", capacityPackages: 30, capacityKg: 500 } });
    const trip = await jsonRequest(`${baseUrl}/api/trips`, { method: "POST", body: { tripDate: "2026-06-23", routeName: "Scan route", origin: "BUE", destination: "DLA", vehicleId: vehicle.body.vehicle.vehicleId } });
    await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/manifest`, { method: "POST", body: { packageId: accepted.body.parcelPackage.packageId } });
    const scanned = await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/manifest/load-scan`, { method: "POST", body: { scan: JSON.stringify({ trackingNumber: accepted.body.parcelPackage.trackingNumber }), actor: "Scanner" } });
    assert.equal(scanned.response.status, 200);
    assert.equal(scanned.body.manifestItem.status, "LOADED");
  });
});

test("HTTP destination reception, finance and collection workflow", async () => {
  await withServer(async (baseUrl) => {
    const created = await jsonRequest(`${baseUrl}/api/bookings`, {
      method: "POST",
      body: {
        senderName: "Pay Later Sender",
        senderPhone: "677000011",
        recipientName: "Receiver Pays",
        recipientPhone: "677000012",
        origin: "BUE",
        destination: "DLA",
        receivingMethod: "DROPOFF",
        service: "STANDARD",
        itemDescription: "Document envelope",
        approximateWeightKg: 1,
        declaredValueCfa: 0
      }
    });
    const accepted = await jsonRequest(`${baseUrl}/api/bookings/${created.body.booking.bookingId}/accept`, {
      method: "POST",
      body: {
        verifiedWeightKg: 1,
        lengthCm: 20,
        widthCm: 10,
        heightCm: 2,
        condition: "GOOD",
        paymentArrangement: "RECIPIENT_PAYS",
        acceptedBy: "Miriam"
      }
    });
    await jsonRequest(`${baseUrl}/api/packages/${accepted.body.parcelPackage.packageId}/store`, { method: "POST", body: { storageLocation: "BUE-DLA-A04", actor: "Peter" } });
    const vehicle = await jsonRequest(`${baseUrl}/api/vehicles`, { method: "POST", body: { registrationNumber: "LT-789-AA", vehicleType: "Van", capacityPackages: 30, capacityKg: 500 } });
    const trip = await jsonRequest(`${baseUrl}/api/trips`, { method: "POST", body: { tripDate: "2026-06-23", routeName: "Buea to Douala", origin: "BUE", destination: "DLA", vehicleId: vehicle.body.vehicle.vehicleId } });
    const manifest = await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/manifest`, { method: "POST", body: { packageId: accepted.body.parcelPackage.packageId } });
    await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/manifest/${manifest.body.manifestItem.manifestItemId}/load`, { method: "POST", body: { actor: "Miriam" } });
    await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/depart`, { method: "POST", body: { actor: "Peter" } });
    const received = await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/receive`, { method: "POST", body: { actor: "Destination Desk", reports: { [manifest.body.manifestItem.manifestItemId]: "ARRIVED" } } });
    assert.equal(received.response.status, 200);

    let bootstrap = await jsonRequest(`${baseUrl}/api/bootstrap`);
    let parcelPackage = bootstrap.body.packages.find((item) => item.packageId === accepted.body.parcelPackage.packageId);
    assert.equal(parcelPackage.status, "ARRIVED_AT_DESTINATION");
    assert.match(parcelPackage.pickupPin, /^\d{6}$/);

    const storedDestination = await jsonRequest(`${baseUrl}/api/packages/${parcelPackage.packageId}/destination-store`, { method: "POST", body: { storageLocation: "DLA-SHELF-A01", actor: "Destination Desk" } });
    assert.equal(storedDestination.response.status, 200);

    const paid = await jsonRequest(`${baseUrl}/api/packages/${parcelPackage.packageId}/payments`, { method: "POST", body: { amountCfa: parcelPackage.finalPriceCfa, mode: "CASH", payerType: "RECIPIENT", receivedBy: "Cashier One" } });
    assert.equal(paid.body.updatedPackage.paymentStatus, "PAID");

    bootstrap = await jsonRequest(`${baseUrl}/api/bootstrap`);
    parcelPackage = bootstrap.body.packages.find((item) => item.packageId === accepted.body.parcelPackage.packageId);
    const collected = await jsonRequest(`${baseUrl}/api/packages/${parcelPackage.packageId}/collect`, { method: "POST", body: { pickupPin: parcelPackage.pickupPin, receiverName: "Receiver Pays", receiverPhone: "677000012", idNote: "ID checked", actor: "Destination Desk" } });
    assert.equal(collected.response.status, 200);
    assert.equal(collected.body.updatedPackage.status, "COLLECTED");

    const finance = await jsonRequest(`${baseUrl}/api/finance/daily`);
    assert.equal(finance.response.status, 200);
    assert.ok(finance.body.summary.totalCollectedCfa >= parcelPackage.finalPriceCfa);
  });
});

test("cashier shifts can be started and closed with variance", async () => {
  await withServer(async (baseUrl) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/login`, { method: "POST", body: { userId: "cashier", pin: "1234" } });
    const shift = await jsonRequest(`${baseUrl}/api/finance/shifts/start`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { openingFloatCfa: 10000, note: "Morning shift" }
    });
    assert.equal(shift.response.status, 201);
    const closing = await jsonRequest(`${baseUrl}/api/finance/shifts/${shift.body.shift.shiftId}/close`, {
      method: "POST",
      headers: { "X-AHLink-Session": login.body.token },
      body: { countedCashCfa: 10000, note: "No variance" }
    });
    assert.equal(closing.response.status, 200);
    assert.equal(closing.body.closing.varianceCfa, 0);
  });
});

test("HTTP destination reception records damaged package exception", async () => {
  await withServer(async (baseUrl) => {
    const created = await jsonRequest(`${baseUrl}/api/bookings`, { method: "POST", body: { senderName: "Damage Sender", senderPhone: "6771", recipientName: "Damage Receiver", recipientPhone: "6772", origin: "BUE", destination: "DLA", receivingMethod: "DROPOFF", service: "STANDARD", itemDescription: "Fragile item", approximateWeightKg: 1, declaredValueCfa: 0 } });
    const accepted = await jsonRequest(`${baseUrl}/api/bookings/${created.body.booking.bookingId}/accept`, { method: "POST", body: { verifiedWeightKg: 1, lengthCm: 20, widthCm: 10, heightCm: 8, condition: "GOOD", paymentArrangement: "SENDER_PAID", acceptedBy: "Miriam" } });
    await jsonRequest(`${baseUrl}/api/packages/${accepted.body.parcelPackage.packageId}/store`, { method: "POST", body: { storageLocation: "BUE-DLA-A05", actor: "Peter" } });
    const vehicle = await jsonRequest(`${baseUrl}/api/vehicles`, { method: "POST", body: { registrationNumber: "LT-999-AA", vehicleType: "Van", capacityPackages: 30, capacityKg: 500 } });
    const trip = await jsonRequest(`${baseUrl}/api/trips`, { method: "POST", body: { tripDate: "2026-06-23", routeName: "Buea to Douala", origin: "BUE", destination: "DLA", vehicleId: vehicle.body.vehicle.vehicleId } });
    const manifest = await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/manifest`, { method: "POST", body: { packageId: accepted.body.parcelPackage.packageId } });
    await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/manifest/${manifest.body.manifestItem.manifestItemId}/load`, { method: "POST", body: { actor: "Miriam" } });
    await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/depart`, { method: "POST", body: { actor: "Peter" } });
    const received = await jsonRequest(`${baseUrl}/api/trips/${trip.body.trip.tripId}/receive`, { method: "POST", body: { actor: "Destination Desk", reports: { [manifest.body.manifestItem.manifestItemId]: "DAMAGED" }, note: "Corner crushed at arrival." } });
    assert.equal(received.response.status, 200);
    const bootstrap = await jsonRequest(`${baseUrl}/api/bootstrap`);
    const parcelPackage = bootstrap.body.packages.find((item) => item.packageId === accepted.body.parcelPackage.packageId);
    assert.equal(parcelPackage.status, "EXCEPTION");
    assert.equal(bootstrap.body.exceptions.length, 1);
  });
});
