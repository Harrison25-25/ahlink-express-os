import crypto from "node:crypto";

export const OFFICES = [
  { code: "BUE", name: "Buea" },
  { code: "LIM", name: "Limbe" },
  { code: "DLA", name: "Douala" }
];

export const BOOKING_STATUSES = Object.freeze({
  AWAITING_DROPOFF: "AWAITING_DROPOFF",
  PICKUP_REQUESTED: "PICKUP_REQUESTED",
  PICKUP_ASSIGNED: "PICKUP_ASSIGNED",
  PICKUP_DISPATCHED: "PICKUP_DISPATCHED",
  PICKED_UP_BY_RIDER: "PICKED_UP_BY_RIDER",
  PICKUP_ARRIVED_AT_OFFICE: "PICKUP_ARRIVED_AT_OFFICE",
  ACCEPTED: "ACCEPTED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED"
});

export const PACKAGE_STATUSES = Object.freeze({
  ACCEPTED_AT_ORIGIN: "ACCEPTED_AT_ORIGIN",
  STORED_AT_ORIGIN: "STORED_AT_ORIGIN",
  LOADED_FOR_DEPARTURE: "LOADED_FOR_DEPARTURE",
  IN_TRANSIT: "IN_TRANSIT",
  ARRIVED_AT_DESTINATION: "ARRIVED_AT_DESTINATION",
  STORED_AT_DESTINATION: "STORED_AT_DESTINATION",
  COLLECTED: "COLLECTED",
  EXCEPTION: "EXCEPTION",
  RETURN_TO_ORIGIN: "RETURN_TO_ORIGIN"
});

export const VEHICLE_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  MAINTENANCE: "MAINTENANCE",
  INACTIVE: "INACTIVE"
});

export const TRIP_STATUSES = Object.freeze({
  PLANNED: "PLANNED",
  LOADING: "LOADING",
  DEPARTED: "DEPARTED",
  ARRIVED: "ARRIVED",
  CANCELLED: "CANCELLED"
});

export const MANIFEST_STATUSES = Object.freeze({
  PENDING: "PENDING",
  LOADED: "LOADED",
  OFFLOADED: "OFFLOADED",
  REMOVED: "REMOVED"
});

export const EXCEPTION_TYPES = Object.freeze({
  MISSING: "MISSING",
  DAMAGED: "DAMAGED",
  WRONG_DESTINATION: "WRONG_DESTINATION",
  REFUSED_COLLECTION: "REFUSED_COLLECTION",
  RETURN_TO_ORIGIN: "RETURN_TO_ORIGIN"
});

export const USER_ROLES = Object.freeze({
  ADMIN: "ADMIN",
  ORIGIN_OFFICER: "ORIGIN_OFFICER",
  DESTINATION_OFFICER: "DESTINATION_OFFICER",
  CASHIER: "CASHIER",
  MANIFEST_OFFICER: "MANIFEST_OFFICER",
  RIDER: "RIDER",
  VIEWER_AUDITOR: "VIEWER_AUDITOR"
});

export const PICKUP_STATUSES = Object.freeze({
  REQUESTED: "REQUESTED",
  ASSIGNED: "ASSIGNED",
  DISPATCHED: "DISPATCHED",
  PICKED_UP: "PICKED_UP",
  ARRIVED_AT_OFFICE: "ARRIVED_AT_OFFICE",
  CANCELLED: "CANCELLED"
});

const ROUTE_BASE_PRICES = {
  "BUE-LIM": 1500,
  "LIM-BUE": 1500,
  "BUE-DLA": 3000,
  "DLA-BUE": 3000,
  "LIM-DLA": 2500,
  "DLA-LIM": 2500
};

export function cleanPhone(value) {
  return String(value || "").replace(/[^0-9+]/g, "");
}

export function requireText(value, label, max = 160) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} is too long.`);
  return text;
}

export function requireOffice(code, label) {
  const value = String(code || "").toUpperCase();
  if (!OFFICES.some((office) => office.code === value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function estimatePrice(origin, destination, weightKg = 1, service = "STANDARD") {
  if (origin === destination) throw new Error("Origin and destination must be different.");
  const base = ROUTE_BASE_PRICES[`${origin}-${destination}`];
  if (!base) throw new Error("This route is not currently supported.");
  const weight = Number(weightKg || 1);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
    throw new Error("Weight must be between 0 and 100 kg.");
  }
  const extraWeight = Math.max(0, Math.ceil(weight - 2)) * 500;
  const expressFee = service === "EXPRESS" ? 1000 : 0;
  return base + extraWeight + expressFee;
}

export function createBooking(input, now = new Date()) {
  const origin = requireOffice(input.origin, "Origin office");
  const destination = requireOffice(input.destination, "Destination office");
  const receivingMethod = input.receivingMethod === "PICKUP" ? "PICKUP" : "DROPOFF";
  const service = input.service === "EXPRESS" ? "EXPRESS" : "STANDARD";
  const approximateWeightKg = Number(input.approximateWeightKg || 1);

  return {
    bookingId: crypto.randomUUID(),
    bookingCode: `BKG-${dateCode(now)}-${randomDigits(5)}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    senderName: requireText(input.senderName, "Sender name", 100),
    senderPhone: requireText(cleanPhone(input.senderPhone), "Sender phone", 20),
    recipientName: requireText(input.recipientName, "Recipient name", 100),
    recipientPhone: requireText(cleanPhone(input.recipientPhone), "Recipient phone", 20),
    origin,
    destination,
    receivingMethod,
    pickupAddress: receivingMethod === "PICKUP" ? requireText(input.pickupAddress, "Pickup address", 220) : "",
    service,
    itemDescription: requireText(input.itemDescription, "Item description", 220),
    approximateWeightKg,
    declaredValueCfa: nonNegativeNumber(input.declaredValueCfa, "Declared value"),
    estimatedPriceCfa: estimatePrice(origin, destination, approximateWeightKg, service),
    status: receivingMethod === "PICKUP" ? BOOKING_STATUSES.PICKUP_REQUESTED : BOOKING_STATUSES.AWAITING_DROPOFF,
    acceptedPackageId: null
  };
}

export function acceptPhysicalPackage(booking, input, sequence, now = new Date()) {
  if (![BOOKING_STATUSES.AWAITING_DROPOFF, BOOKING_STATUSES.PICKUP_REQUESTED, BOOKING_STATUSES.PICKUP_ARRIVED_AT_OFFICE].includes(booking.status)) {
    throw new Error("This booking cannot be physically accepted in its current status.");
  }

  const verifiedWeightKg = positiveNumber(input.verifiedWeightKg, "Verified weight", 100);
  const lengthCm = positiveNumber(input.lengthCm, "Length", 300);
  const widthCm = positiveNumber(input.widthCm, "Width", 300);
  const heightCm = positiveNumber(input.heightCm, "Height", 300);
  const acceptedBy = requireText(input.acceptedBy, "Accepting employee", 100);
  const condition = ["GOOD", "MINOR_DAMAGE", "REQUIRES_REPACKAGING"].includes(input.condition)
    ? input.condition
    : "GOOD";
  const paymentArrangement = ["SENDER_PAID", "RECIPIENT_PAYS", "ACCOUNT"].includes(input.paymentArrangement)
    ? input.paymentArrangement
    : "SENDER_PAID";
  const packageId = crypto.randomUUID();
  const trackingNumber = `AHE-${booking.origin}-${booking.destination}-${dateCode(now)}-${String(sequence).padStart(5, "0")}`;
  const finalPriceCfa = estimatePrice(booking.origin, booking.destination, verifiedWeightKg, booking.service);

  const parcelPackage = {
    packageId,
    bookingId: booking.bookingId,
    trackingNumber,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    origin: booking.origin,
    destination: booking.destination,
    senderName: booking.senderName,
    senderPhone: booking.senderPhone,
    recipientName: booking.recipientName,
    recipientPhone: booking.recipientPhone,
    itemDescription: booking.itemDescription,
    verifiedWeightKg,
    dimensionsCm: { length: lengthCm, width: widthCm, height: heightCm },
    declaredValueCfa: booking.declaredValueCfa,
    finalPriceCfa,
    paymentArrangement,
    paymentStatus: paymentArrangement === "SENDER_PAID" ? "PAID" : "PENDING",
    paidCfa: paymentArrangement === "SENDER_PAID" ? finalPriceCfa : 0,
    condition,
    sealNumber: String(input.sealNumber || "").trim(),
    status: PACKAGE_STATUSES.ACCEPTED_AT_ORIGIN,
    currentOffice: booking.origin,
    storageLocation: null,
    acceptedBy
  };

  const event = createEvent({
    packageId,
    type: "PACKAGE_ACCEPTED",
    previousStatus: null,
    newStatus: PACKAGE_STATUSES.ACCEPTED_AT_ORIGIN,
    actor: acceptedBy,
    office: booking.origin,
    note: `Physical package verified at ${verifiedWeightKg} kg and accepted into AHLink Express custody.`,
    now
  });

  return { parcelPackage, event, finalPriceCfa };
}

export function ensurePickupTask(booking, now = new Date()) {
  if (booking.receivingMethod !== "PICKUP") throw new Error("This booking is not a pickup request.");
  return {
    pickupTaskId: crypto.randomUUID(),
    bookingId: booking.bookingId,
    bookingCode: booking.bookingCode,
    senderName: booking.senderName,
    senderPhone: booking.senderPhone,
    pickupAddress: booking.pickupAddress,
    origin: booking.origin,
    destination: booking.destination,
    itemDescription: booking.itemDescription,
    status: PICKUP_STATUSES.REQUESTED,
    riderUserId: "",
    riderName: "",
    riderPhone: "",
    assignedBy: "",
    assignedAt: null,
    dispatchedAt: null,
    pickedUpAt: null,
    arrivedAtOfficeAt: null,
    pickupProofNote: "",
    officeArrivalNote: "",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function assignPickupTask(task, input = {}, now = new Date()) {
  if (![PICKUP_STATUSES.REQUESTED, PICKUP_STATUSES.ASSIGNED].includes(task.status)) {
    throw new Error("Only requested pickup tasks can be assigned.");
  }
  return {
    ...task,
    status: PICKUP_STATUSES.ASSIGNED,
    riderUserId: requireText(input.riderUserId, "Rider", 80),
    riderName: requireText(input.riderName, "Rider name", 100),
    riderPhone: cleanPhone(input.riderPhone || ""),
    assignedBy: requireText(input.assignedBy, "Dispatch officer", 100),
    assignedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function dispatchPickupTask(task, input = {}, now = new Date()) {
  if (task.status !== PICKUP_STATUSES.ASSIGNED) throw new Error("Assign a rider before dispatching pickup.");
  return {
    ...task,
    status: PICKUP_STATUSES.DISPATCHED,
    dispatchedAt: now.toISOString(),
    dispatchNote: String(input.note || "").trim(),
    updatedAt: now.toISOString()
  };
}

export function confirmPickupCollected(task, input = {}, now = new Date()) {
  if (task.status !== PICKUP_STATUSES.DISPATCHED) throw new Error("Only dispatched pickups can be confirmed collected.");
  return {
    ...task,
    status: PICKUP_STATUSES.PICKED_UP,
    pickedUpAt: now.toISOString(),
    pickupProofNote: requireText(input.pickupProofNote || input.note, "Pickup proof note", 300),
    senderNameConfirmed: String(input.senderNameConfirmed || task.senderName).trim(),
    updatedAt: now.toISOString()
  };
}

export function confirmPickupArrivedAtOffice(task, input = {}, now = new Date()) {
  if (task.status !== PICKUP_STATUSES.PICKED_UP) throw new Error("Only rider-collected pickups can be received at the office.");
  return {
    ...task,
    status: PICKUP_STATUSES.ARRIVED_AT_OFFICE,
    arrivedAtOfficeAt: now.toISOString(),
    officeArrivalNote: String(input.officeArrivalNote || input.note || "").trim(),
    updatedAt: now.toISOString()
  };
}

export function storePackage(parcelPackage, input, now = new Date()) {
  if (parcelPackage.status !== PACKAGE_STATUSES.ACCEPTED_AT_ORIGIN) {
    throw new Error("Only a newly accepted package can be placed into origin storage.");
  }
  const storageLocation = requireText(input.storageLocation, "Storage location", 80).toUpperCase();
  const actor = requireText(input.actor, "Employee", 100);
  const previousStatus = parcelPackage.status;
  const updatedPackage = {
    ...parcelPackage,
    status: PACKAGE_STATUSES.STORED_AT_ORIGIN,
    storageLocation,
    updatedAt: now.toISOString()
  };
  const event = createEvent({
    packageId: parcelPackage.packageId,
    type: "PACKAGE_STORED",
    previousStatus,
    newStatus: PACKAGE_STATUSES.STORED_AT_ORIGIN,
    actor,
    office: parcelPackage.currentOffice,
    note: `Package placed in ${storageLocation}.`,
    now
  });
  return { updatedPackage, event };
}

export function createVehicle(input, now = new Date()) {
  const registrationNumber = requireText(input.registrationNumber, "Registration number", 40).toUpperCase();
  const status = Object.values(VEHICLE_STATUSES).includes(input.status) ? input.status : VEHICLE_STATUSES.ACTIVE;
  return {
    vehicleId: crypto.randomUUID(),
    registrationNumber,
    vehicleType: requireText(input.vehicleType || "Van", "Vehicle type", 80),
    driverName: String(input.driverName || "").trim(),
    driverPhone: cleanPhone(input.driverPhone || ""),
    capacityPackages: nonNegativeNumber(input.capacityPackages, "Package capacity"),
    capacityKg: nonNegativeNumber(input.capacityKg, "Weight capacity"),
    status,
    notes: String(input.notes || "").trim(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function createOrUpdateStaffUser(existingUser, input, now = new Date()) {
  const role = Object.values(USER_ROLES).includes(input.role) ? input.role : USER_ROLES.VIEWER_AUDITOR;
  const userId = requireText(input.userId || existingUser?.userId, "User ID", 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!userId) throw new Error("User ID is required.");
  const pin = String(input.pin || existingUser?.pin || "").trim();
  if (!existingUser && pin.length < 4) throw new Error("PIN must be at least 4 digits for a new staff user.");
  return {
    ...(existingUser || {}),
    userId,
    name: requireText(input.name || existingUser?.name, "Staff name", 100),
    role,
    office: requireOffice(input.office || existingUser?.office, "Staff office"),
    pin: pin || existingUser.pin,
    isActive: input.isActive === false || input.isActive === "false" ? false : true,
    createdAt: existingUser?.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function updateStaffPin(user, input, now = new Date()) {
  const pin = requireText(input.pin, "New PIN", 20);
  if (pin.length < 4) throw new Error("PIN must be at least 4 digits.");
  return { ...user, pin, updatedAt: now.toISOString() };
}

export function createOrUpdateOffice(existingOffice, input, now = new Date()) {
  const code = requireText(input.code || existingOffice?.code, "Office code", 8).toUpperCase();
  return {
    ...(existingOffice || {}),
    code,
    name: requireText(input.name || existingOffice?.name, "Office name", 80),
    isActive: input.isActive === false || input.isActive === "false" ? false : true,
    createdAt: existingOffice?.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function createOrUpdateRoute(existingRoute, input, now = new Date()) {
  const origin = requireOffice(input.origin || existingRoute?.origin, "Route origin");
  const destination = requireOffice(input.destination || existingRoute?.destination, "Route destination");
  if (origin === destination) throw new Error("Route origin and destination must be different.");
  const routeId = existingRoute?.routeId || `${origin}-${destination}`;
  return {
    ...(existingRoute || {}),
    routeId,
    origin,
    destination,
    name: requireText(input.name || existingRoute?.name || `${origin} to ${destination}`, "Route name", 120),
    basePriceCfa: nonNegativeNumber(input.basePriceCfa ?? existingRoute?.basePriceCfa, "Base price"),
    isActive: input.isActive === false || input.isActive === "false" ? false : true,
    createdAt: existingRoute?.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function startCashierShift(input, now = new Date()) {
  return {
    shiftId: crypto.randomUUID(),
    cashierUserId: requireText(input.cashierUserId, "Cashier user", 80),
    cashierName: requireText(input.cashierName, "Cashier name", 100),
    office: requireOffice(input.office, "Cashier office"),
    openingFloatCfa: nonNegativeNumber(input.openingFloatCfa, "Opening float"),
    status: "OPEN",
    openedAt: now.toISOString(),
    closedAt: null,
    note: String(input.note || "").trim()
  };
}

export function closeCashierShift(shift, payments, input = {}, now = new Date()) {
  if (shift.status !== "OPEN") throw new Error("Only an open cashier shift can be closed.");
  const countedCashCfa = nonNegativeNumber(input.countedCashCfa, "Counted cash");
  const shiftPayments = payments.filter((payment) => payment.shiftId === shift.shiftId);
  const byMode = totalPaymentsByMode(shiftPayments);
  const expectedCashCfa = Number(shift.openingFloatCfa || 0) + Number(byMode.CASH || 0);
  return {
    closingId: crypto.randomUUID(),
    shiftId: shift.shiftId,
    cashierUserId: shift.cashierUserId,
    cashierName: shift.cashierName,
    office: shift.office,
    openedAt: shift.openedAt,
    closedAt: now.toISOString(),
    openingFloatCfa: Number(shift.openingFloatCfa || 0),
    expectedCashCfa,
    countedCashCfa,
    varianceCfa: countedCashCfa - expectedCashCfa,
    paymentCount: shiftPayments.length,
    totalCollectedCfa: shiftPayments.reduce((sum, payment) => sum + Number(payment.amountCfa || 0), 0),
    byMode,
    note: String(input.note || "").trim()
  };
}

export function createTrip(input, now = new Date()) {
  const origin = requireOffice(input.origin, "Origin office");
  const destination = requireOffice(input.destination, "Destination office");
  if (origin === destination) throw new Error("Trip origin and destination must be different.");
  return {
    tripId: crypto.randomUUID(),
    tripCode: `TRP-${origin}-${destination}-${dateCode(now)}-${randomDigits(4)}`,
    tripDate: String(input.tripDate || now.toISOString().slice(0, 10)).slice(0, 10),
    routeName: requireText(input.routeName || `${origin} to ${destination}`, "Route name", 120),
    origin,
    destination,
    vehicleId: requireText(input.vehicleId, "Vehicle", 80),
    driverName: String(input.driverName || "").trim(),
    driverPhone: cleanPhone(input.driverPhone || ""),
    scheduledDeparture: String(input.scheduledDeparture || ""),
    status: TRIP_STATUSES.PLANNED,
    note: String(input.note || "").trim(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    departedAt: null,
    arrivedAt: null
  };
}

export function addPackageToManifest(trip, parcelPackage, input = {}, now = new Date()) {
  if (![TRIP_STATUSES.PLANNED, TRIP_STATUSES.LOADING].includes(trip.status)) {
    throw new Error("Only planned/loading trips can receive manifest items.");
  }
  if (parcelPackage.status !== PACKAGE_STATUSES.STORED_AT_ORIGIN) {
    throw new Error("Only packages stored at origin can be added to a trip manifest.");
  }
  if (parcelPackage.origin !== trip.origin || parcelPackage.destination !== trip.destination) {
    throw new Error("Package route must match the trip route.");
  }
  return {
    manifestItemId: crypto.randomUUID(),
    tripId: trip.tripId,
    packageId: parcelPackage.packageId,
    trackingNumber: parcelPackage.trackingNumber,
    senderName: parcelPackage.senderName,
    recipientName: parcelPackage.recipientName,
    packageDescription: parcelPackage.itemDescription,
    weightKg: parcelPackage.verifiedWeightKg,
    status: MANIFEST_STATUSES.PENDING,
    loadedAt: null,
    loadedBy: "",
    offloadedAt: null,
    offloadedBy: "",
    note: String(input.note || "").trim(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function markManifestLoaded(manifestItem, parcelPackage, input = {}, now = new Date()) {
  if (manifestItem.status !== MANIFEST_STATUSES.PENDING) {
    throw new Error("Only pending manifest items can be loaded.");
  }
  const actor = requireText(input.actor, "Loading employee", 100);
  return {
    manifestItem: { ...manifestItem, status: MANIFEST_STATUSES.LOADED, loadedAt: now.toISOString(), loadedBy: actor, updatedAt: now.toISOString() },
    parcelPackage: { ...parcelPackage, status: PACKAGE_STATUSES.LOADED_FOR_DEPARTURE, updatedAt: now.toISOString() },
    event: createEvent({
      packageId: parcelPackage.packageId,
      type: "PACKAGE_LOADED",
      previousStatus: parcelPackage.status,
      newStatus: PACKAGE_STATUSES.LOADED_FOR_DEPARTURE,
      actor,
      office: parcelPackage.currentOffice,
      note: `Package loaded for trip manifest ${manifestItem.tripId}.`,
      now
    })
  };
}

export function departTrip(trip, manifestItems, packages, input = {}, now = new Date()) {
  if (![TRIP_STATUSES.PLANNED, TRIP_STATUSES.LOADING].includes(trip.status)) {
    throw new Error("Only planned/loading trips can depart.");
  }
  const activeItems = manifestItems.filter((item) => item.status !== MANIFEST_STATUSES.REMOVED);
  if (!activeItems.length) throw new Error("A trip cannot depart with an empty manifest.");
  if (activeItems.some((item) => item.status !== MANIFEST_STATUSES.LOADED)) {
    throw new Error("Every manifest item must be loaded before departure.");
  }
  const actor = requireText(input.actor, "Departure employee", 100);
  const packageById = new Map(packages.map((item) => [item.packageId, item]));
  const updatedPackages = activeItems.map((item) => {
    const parcelPackage = packageById.get(item.packageId);
    if (!parcelPackage) throw new Error(`Package ${item.trackingNumber} is missing.`);
    return { ...parcelPackage, status: PACKAGE_STATUSES.IN_TRANSIT, storageLocation: null, updatedAt: now.toISOString() };
  });
  const events = updatedPackages.map((parcelPackage) => createEvent({
    packageId: parcelPackage.packageId,
    type: "TRIP_DEPARTED",
    previousStatus: PACKAGE_STATUSES.LOADED_FOR_DEPARTURE,
    newStatus: PACKAGE_STATUSES.IN_TRANSIT,
    actor,
    office: trip.origin,
    note: `Trip ${trip.tripCode} departed from ${trip.origin} to ${trip.destination}.`,
    now
  }));
  return {
    trip: { ...trip, status: TRIP_STATUSES.DEPARTED, departedAt: now.toISOString(), updatedAt: now.toISOString() },
    packages: updatedPackages,
    events
  };
}

export function receiveTripAtDestination(trip, manifestItems, packages, input = {}, now = new Date()) {
  if (trip.status !== TRIP_STATUSES.DEPARTED) throw new Error("Only departed trips can be received.");
  const actor = requireText(input.actor, "Receiving employee", 100);
  const reports = input.reports || {};
  const packageById = new Map(packages.map((item) => [item.packageId, item]));
  const updatedPackages = [];
  const updatedManifestItems = [];
  const events = [];
  const exceptions = [];

  for (const item of manifestItems.filter((row) => row.status !== MANIFEST_STATUSES.REMOVED)) {
    const report = String(reports[item.manifestItemId] || "ARRIVED").toUpperCase();
    const parcelPackage = packageById.get(item.packageId);
    if (!parcelPackage) throw new Error(`Package ${item.trackingNumber} is missing.`);
    if (parcelPackage.status !== PACKAGE_STATUSES.IN_TRANSIT) throw new Error(`${item.trackingNumber} is not in transit.`);

    if (report === "ARRIVED") {
      const pickupPin = String(crypto.randomInt(100000, 1000000));
      updatedPackages.push({ ...parcelPackage, status: PACKAGE_STATUSES.ARRIVED_AT_DESTINATION, currentOffice: trip.destination, pickupPin, updatedAt: now.toISOString() });
      updatedManifestItems.push({ ...item, status: MANIFEST_STATUSES.OFFLOADED, offloadedAt: now.toISOString(), offloadedBy: actor, updatedAt: now.toISOString() });
      events.push(createEvent({ packageId: item.packageId, type: "PACKAGE_ARRIVED_DESTINATION", previousStatus: PACKAGE_STATUSES.IN_TRANSIT, newStatus: PACKAGE_STATUSES.ARRIVED_AT_DESTINATION, actor, office: trip.destination, note: `Package received from trip ${trip.tripCode}. Pickup PIN generated.`, now }));
    } else {
      const exceptionType = Object.values(EXCEPTION_TYPES).includes(report) ? report : EXCEPTION_TYPES.MISSING;
      const nextStatus = exceptionType === EXCEPTION_TYPES.RETURN_TO_ORIGIN ? PACKAGE_STATUSES.RETURN_TO_ORIGIN : PACKAGE_STATUSES.EXCEPTION;
      updatedPackages.push({ ...parcelPackage, status: nextStatus, currentOffice: trip.destination, exceptionType, exceptionNote: String(input.note || "").trim(), updatedAt: now.toISOString() });
      updatedManifestItems.push({ ...item, status: exceptionType === EXCEPTION_TYPES.MISSING ? MANIFEST_STATUSES.LOADED : MANIFEST_STATUSES.OFFLOADED, offloadedAt: exceptionType === EXCEPTION_TYPES.MISSING ? null : now.toISOString(), offloadedBy: exceptionType === EXCEPTION_TYPES.MISSING ? "" : actor, updatedAt: now.toISOString() });
      const exception = createException(item.packageId, exceptionType, actor, trip.destination, input.note || `Exception recorded during reception of ${trip.tripCode}.`, now);
      exceptions.push(exception);
      events.push(createEvent({ packageId: item.packageId, type: `EXCEPTION_${exceptionType}`, previousStatus: PACKAGE_STATUSES.IN_TRANSIT, newStatus: nextStatus, actor, office: trip.destination, note: exception.note, now }));
    }
  }

  return {
    trip: { ...trip, status: TRIP_STATUSES.ARRIVED, arrivedAt: now.toISOString(), receivedBy: actor, updatedAt: now.toISOString() },
    packages: updatedPackages,
    manifestItems: updatedManifestItems,
    events,
    exceptions
  };
}

export function storeAtDestination(parcelPackage, input = {}, now = new Date()) {
  if (parcelPackage.status !== PACKAGE_STATUSES.ARRIVED_AT_DESTINATION) {
    throw new Error("Only arrived destination packages can be stored at destination.");
  }
  const storageLocation = requireText(input.storageLocation, "Destination shelf/bin", 80).toUpperCase();
  const actor = requireText(input.actor, "Storage employee", 100);
  const updatedPackage = { ...parcelPackage, status: PACKAGE_STATUSES.STORED_AT_DESTINATION, storageLocation, updatedAt: now.toISOString() };
  return {
    updatedPackage,
    event: createEvent({ packageId: parcelPackage.packageId, type: "PACKAGE_DESTINATION_STORED", previousStatus: parcelPackage.status, newStatus: PACKAGE_STATUSES.STORED_AT_DESTINATION, actor, office: parcelPackage.currentOffice, note: `Package stored at destination shelf/bin ${storageLocation}.`, now })
  };
}

export function collectPackage(parcelPackage, input = {}, now = new Date()) {
  if (parcelPackage.status !== PACKAGE_STATUSES.STORED_AT_DESTINATION) {
    throw new Error("Only destination-stored packages can be collected.");
  }
  const pickupPin = requireText(input.pickupPin, "Pickup PIN", 20);
  if (parcelPackage.pickupPin && pickupPin !== parcelPackage.pickupPin) throw new Error("Pickup PIN does not match.");
  const receiverName = requireText(input.receiverName, "Receiver name", 100);
  const receiverPhone = requireText(cleanPhone(input.receiverPhone), "Receiver phone", 20);
  const actor = requireText(input.actor, "Releasing employee", 100);
  const collection = {
    collectionId: crypto.randomUUID(),
    packageId: parcelPackage.packageId,
    trackingNumber: parcelPackage.trackingNumber,
    receiverName,
    receiverPhone,
    idNote: String(input.idNote || "").trim(),
    signaturePlaceholder: String(input.signaturePlaceholder || "SIGNATURE_CAPTURE_PENDING").trim(),
    photoPlaceholder: String(input.photoPlaceholder || "PHOTO_CAPTURE_PENDING").trim(),
    releasedBy: actor,
    collectedAt: now.toISOString()
  };
  const updatedPackage = { ...parcelPackage, status: PACKAGE_STATUSES.COLLECTED, collectedAt: now.toISOString(), collectedBy: receiverName, storageLocation: null, updatedAt: now.toISOString() };
  return {
    updatedPackage,
    collection,
    event: createEvent({ packageId: parcelPackage.packageId, type: "PACKAGE_COLLECTED", previousStatus: parcelPackage.status, newStatus: PACKAGE_STATUSES.COLLECTED, actor, office: parcelPackage.currentOffice, note: `Package collected by ${receiverName}.`, now })
  };
}

export function recordException(parcelPackage, input = {}, now = new Date()) {
  const exceptionType = Object.values(EXCEPTION_TYPES).includes(input.exceptionType) ? input.exceptionType : EXCEPTION_TYPES.DAMAGED;
  const actor = requireText(input.actor, "Employee", 100);
  const office = requireOffice(input.office || parcelPackage.currentOffice, "Exception office");
  const note = requireText(input.note, "Exception note", 500);
  const nextStatus = exceptionType === EXCEPTION_TYPES.RETURN_TO_ORIGIN ? PACKAGE_STATUSES.RETURN_TO_ORIGIN : PACKAGE_STATUSES.EXCEPTION;
  const exception = createException(parcelPackage.packageId, exceptionType, actor, office, note, now);
  const updatedPackage = { ...parcelPackage, status: nextStatus, exceptionType, exceptionNote: note, currentOffice: office, updatedAt: now.toISOString() };
  return {
    updatedPackage,
    exception,
    event: createEvent({ packageId: parcelPackage.packageId, type: `EXCEPTION_${exceptionType}`, previousStatus: parcelPackage.status, newStatus: nextStatus, actor, office, note, now })
  };
}

export function recordPayment(parcelPackage, input = {}, now = new Date()) {
  const amountCfa = nonNegativeNumber(input.amountCfa, "Payment amount");
  if (amountCfa <= 0) throw new Error("Payment amount must be greater than zero.");
  const receivedBy = requireText(input.receivedBy, "Cashier", 100);
  const payment = {
    paymentId: crypto.randomUUID(),
    packageId: parcelPackage.packageId,
    trackingNumber: parcelPackage.trackingNumber,
    amountCfa,
    mode: ["CASH", "MOMO", "ACCOUNT"].includes(input.mode) ? input.mode : "CASH",
    payerType: ["SENDER", "RECIPIENT", "ACCOUNT"].includes(input.payerType) ? input.payerType : "RECIPIENT",
    receivedBy,
    receivedByUserId: String(input.receivedByUserId || "").trim(),
    shiftId: String(input.shiftId || "").trim(),
    note: String(input.note || "").trim(),
    paidAt: now.toISOString()
  };
  const paidCfa = Number(parcelPackage.paidCfa || 0) + amountCfa;
  const paymentStatus = paidCfa >= Number(parcelPackage.finalPriceCfa || 0) ? "PAID" : "PARTIAL";
  const updatedPackage = { ...parcelPackage, paidCfa, paymentStatus, updatedAt: now.toISOString() };
  return {
    updatedPackage,
    payment,
    event: createEvent({ packageId: parcelPackage.packageId, type: "PAYMENT_RECORDED", previousStatus: parcelPackage.status, newStatus: parcelPackage.status, actor: receivedBy, office: parcelPackage.currentOffice, note: `${amountCfa} FCFA payment recorded by ${payment.mode}.`, now })
  };
}

export function createFinanceSummary(database, dateText) {
  const date = String(dateText || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const payments = (database.payments || []).filter((payment) => String(payment.paidAt || "").slice(0, 10) === date);
  const totalCollectedCfa = payments.reduce((sum, payment) => sum + Number(payment.amountCfa || 0), 0);
  const outstandingPackages = (database.packages || []).filter((item) => !["PAID"].includes(item.paymentStatus));
  const outstandingCfa = outstandingPackages.reduce((sum, item) => sum + Math.max(0, Number(item.finalPriceCfa || 0) - Number(item.paidCfa || 0)), 0);
  const byMode = payments.reduce((all, payment) => {
    all[payment.mode] = (all[payment.mode] || 0) + Number(payment.amountCfa || 0);
    return all;
  }, {});
  const byPayerType = payments.reduce((all, payment) => {
    all[payment.payerType] = (all[payment.payerType] || 0) + Number(payment.amountCfa || 0);
    return all;
  }, {});
  const outstandingByAccount = outstandingPackages
    .filter((item) => item.paymentArrangement === "ACCOUNT")
    .reduce((all, item) => {
      const name = item.senderName || "Account customer";
      all[name] = (all[name] || 0) + Math.max(0, Number(item.finalPriceCfa || 0) - Number(item.paidCfa || 0));
      return all;
    }, {});
  const outstandingByRoute = outstandingPackages.reduce((all, item) => {
    const route = `${item.origin}-${item.destination}`;
    all[route] = (all[route] || 0) + Math.max(0, Number(item.finalPriceCfa || 0) - Number(item.paidCfa || 0));
    return all;
  }, {});
  return {
    date,
    totalCollectedCfa,
    paymentCount: payments.length,
    outstandingCfa,
    outstandingCount: outstandingPackages.length,
    byMode,
    byPayerType,
    outstandingByAccount,
    outstandingByRoute,
    openShifts: (database.cashierShifts || []).filter((shift) => shift.status === "OPEN"),
    closings: (database.cashClosings || []).filter((closing) => String(closing.closedAt || "").slice(0, 10) === date)
  };
}

function totalPaymentsByMode(payments) {
  return payments.reduce((all, payment) => {
    all[payment.mode] = (all[payment.mode] || 0) + Number(payment.amountCfa || 0);
    return all;
  }, {});
}

function createException(packageId, exceptionType, actor, office, note, now) {
  return {
    exceptionId: crypto.randomUUID(),
    packageId,
    exceptionType,
    actor,
    office,
    note: String(note || "").trim(),
    createdAt: now.toISOString()
  };
}

export function createEvent({ packageId, type, previousStatus, newStatus, actor, office, note, now = new Date() }) {
  return {
    eventId: crypto.randomUUID(),
    packageId,
    type,
    previousStatus,
    newStatus,
    actor,
    office,
    note,
    createdAt: now.toISOString()
  };
}

function nonNegativeNumber(value, label) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or greater.`);
  return number;
}

function positiveNumber(value, label, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) {
    throw new Error(`${label} must be between 0 and ${max}.`);
  }
  return number;
}

function dateCode(date) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function randomDigits(length) {
  return Array.from({ length }, () => crypto.randomInt(0, 10)).join("");
}
