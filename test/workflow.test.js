import test from "node:test";
import assert from "node:assert/strict";
import { acceptPhysicalPackage, addPackageToManifest, createBooking, createTrip, createVehicle, departTrip, estimatePrice, markManifestLoaded, storePackage } from "../src/domain.js";

const bookingInput = {
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
};

test("booking does not imply physical custody", () => {
  const booking = createBooking(bookingInput, new Date("2026-06-22T09:00:00Z"));
  assert.equal(booking.status, "AWAITING_DROPOFF");
  assert.equal(booking.acceptedPackageId, null);
  assert.equal(booking.estimatedPriceCfa, 3000);
});

test("physical acceptance activates tracking and custody event", () => {
  const booking = createBooking(bookingInput, new Date("2026-06-22T09:00:00Z"));
  const result = acceptPhysicalPackage(booking, {
    verifiedWeightKg: 3.4,
    lengthCm: 40,
    widthCm: 30,
    heightCm: 20,
    condition: "GOOD",
    sealNumber: "SL-1001",
    paymentArrangement: "SENDER_PAID",
    acceptedBy: "Miriam"
  }, 1, new Date("2026-06-22T10:00:00Z"));

  assert.equal(result.parcelPackage.trackingNumber, "AHE-BUE-DLA-260622-00001");
  assert.equal(result.parcelPackage.status, "ACCEPTED_AT_ORIGIN");
  assert.equal(result.event.type, "PACKAGE_ACCEPTED");
  assert.equal(result.finalPriceCfa, 4000);
});

test("storage scan advances only an accepted package", () => {
  const booking = createBooking(bookingInput);
  const { parcelPackage } = acceptPhysicalPackage(booking, {
    verifiedWeightKg: 1,
    lengthCm: 20,
    widthCm: 15,
    heightCm: 10,
    condition: "GOOD",
    paymentArrangement: "RECIPIENT_PAYS",
    acceptedBy: "Miriam"
  }, 2);
  const stored = storePackage(parcelPackage, { storageLocation: "BUE-DLA-A01", actor: "Peter" });
  assert.equal(stored.updatedPackage.status, "STORED_AT_ORIGIN");
  assert.equal(stored.updatedPackage.storageLocation, "BUE-DLA-A01");
  assert.equal(stored.event.previousStatus, "ACCEPTED_AT_ORIGIN");
});

test("same-office routes and invalid state transitions are rejected", () => {
  assert.throws(() => estimatePrice("BUE", "BUE", 1), /different/);
  const booking = createBooking(bookingInput);
  booking.status = "ACCEPTED";
  assert.throws(() => acceptPhysicalPackage(booking, {}, 3), /cannot be physically accepted/);
});

test("trip manifest requires stored packages before departure", () => {
  const booking = createBooking(bookingInput, new Date("2026-06-22T09:00:00Z"));
  const { parcelPackage } = acceptPhysicalPackage(booking, {
    verifiedWeightKg: 2,
    lengthCm: 20,
    widthCm: 15,
    heightCm: 10,
    condition: "GOOD",
    paymentArrangement: "SENDER_PAID",
    acceptedBy: "Miriam"
  }, 3, new Date("2026-06-22T10:00:00Z"));
  const stored = storePackage(parcelPackage, { storageLocation: "BUE-DLA-A02", actor: "Peter" }, new Date("2026-06-22T10:05:00Z"));
  const vehicle = createVehicle({ registrationNumber: "LT-123-AA", vehicleType: "Van", capacityPackages: 20, capacityKg: 500 });
  const trip = createTrip({ tripDate: "2026-06-22", routeName: "Buea to Douala", origin: "BUE", destination: "DLA", vehicleId: vehicle.vehicleId });
  const manifestItem = addPackageToManifest(trip, stored.updatedPackage);

  assert.equal(manifestItem.status, "PENDING");
  assert.throws(() => departTrip(trip, [manifestItem], [stored.updatedPackage], { actor: "Miriam" }), /must be loaded/);

  const loaded = markManifestLoaded(manifestItem, stored.updatedPackage, { actor: "Miriam" });
  const departed = departTrip(trip, [loaded.manifestItem], [loaded.parcelPackage], { actor: "Peter" });
  assert.equal(departed.trip.status, "DEPARTED");
  assert.equal(departed.packages[0].status, "IN_TRANSIT");
});
