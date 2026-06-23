const state = { offices: [], companySettings: {}, officeSettings: [], routeSettings: [], roles: [], users: [], riders: [], customerAccounts: [], bookings: [], pickupTasks: [], packages: [], vehicles: [], trips: [], manifests: [], collections: [], exceptions: [], payments: [], cashierShifts: [], cashClosings: [], auditLogs: [], finance: {}, dashboard: {} };
let sessionToken = localStorage.getItem("ahe_session_token") || "";
let session = JSON.parse(localStorage.getItem("ahe_session") || "null");
let officeFilter = localStorage.getItem("ahe_office_filter") || "";

document.addEventListener("DOMContentLoaded", async () => {
  bindLogin();
  bindNavigation();
  bindForms();
  await refresh();
});

async function refresh() {
  const qs = officeFilter ? `?office=${encodeURIComponent(officeFilter)}` : "";
  const data = await api(`/api/bootstrap${qs}`);
  Object.assign(state, data);
  if (data.session && !session) session = data.session;
  renderSession(data.allowedViews || []);
  populateOffices();
  renderDashboard();
  renderPickupDispatch();
  renderAcceptanceOptions();
  renderInventory();
  renderTripOps();
  renderDestinationOps();
  renderExceptions();
  renderFinance();
  renderAccounts();
  renderNotifications();
  renderAdmin();
  renderAudit();
}

function bindLogin() {
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/auth/login", { method: "POST", body: formJson(event.currentTarget), auth: false });
      sessionToken = result.token;
      session = result.session;
      localStorage.setItem("ahe_session_token", sessionToken);
      localStorage.setItem("ahe_session", JSON.stringify(session));
      officeFilter = session.office;
      localStorage.setItem("ahe_office_filter", officeFilter);
      await refresh();
      toast("Logged in.");
    } catch (error) {
      const fallback = await api("/api/bootstrap", { auth: false });
      if (fallback.session) {
        session = fallback.session;
        sessionToken = "";
        localStorage.setItem("ahe_session", JSON.stringify(session));
        localStorage.removeItem("ahe_session_token");
        officeFilter = session.office;
        localStorage.setItem("ahe_office_filter", officeFilter);
        await refresh();
        toast("Using local pilot admin session.");
      } else {
        toast(error.message, true);
      }
    }
  });
  document.querySelector("#logout-button").addEventListener("click", () => {
    localStorage.removeItem("ahe_session_token");
    localStorage.removeItem("ahe_session");
    sessionToken = "";
    session = null;
    document.querySelector("#login-screen").classList.remove("hidden");
  });
  document.querySelector("#office-filter").addEventListener("change", async (event) => {
    officeFilter = event.target.value;
    localStorage.setItem("ahe_office_filter", officeFilter);
    await refresh();
  });
}

function renderSession(allowedViews) {
  document.querySelector("#login-screen").classList.toggle("hidden", !!session);
  if (!session) return;
  const initials = session.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  document.querySelector("#operator-initials").textContent = initials;
  document.querySelector("#operator-name").textContent = session.name;
  document.querySelector("#operator-role").textContent = `${label(session.role)} · ${session.office}`;
  document.querySelector("#office-chip-text").textContent = `${session.office} office session`;
  if (document.querySelector("#acceptance-form").acceptedBy) document.querySelector("#acceptance-form").acceptedBy.value = session.name;
  const officeSelect = document.querySelector("#office-filter");
  if (!officeFilter) officeFilter = session.office;
  officeSelect.value = officeFilter;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("hidden", allowedViews.length && !allowedViews.includes(item.dataset.view)));
  if (allowedViews.length && !allowedViews.includes(document.querySelector(".view.active").id)) showView(allowedViews[0]);
}

function currentActor() {
  return session ? session.name : "Manager One";
}

function bindNavigation() {
  document.querySelectorAll("[data-view], [data-go]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view || button.dataset.go));
  });
}

function showView(id) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === id));
  const titles = { dashboard: "Operations overview", bookings: "Register a booking", pickup: "Pickup dispatch", acceptance: "Physical package acceptance", inventory: "Package inventory", trips: "Trips and manifest control", destination: "Destination reception and collection", exceptions: "Exception control", finance: "Finance and cashier report", accounts: "Customer accounts", notifications: "Notifications and print", admin: "Admin settings", audit: "Audit trail", tracking: "Package tracking" };
  document.querySelector("#page-title").textContent = titles[id];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindForms() {
  const bookingForm = document.querySelector("#booking-form");
  bookingForm.receivingMethod.addEventListener("change", () => {
    const pickup = bookingForm.receivingMethod.value === "PICKUP";
    document.querySelector(".pickup-field").classList.toggle("hidden", !pickup);
    bookingForm.pickupAddress.required = pickup;
  });

  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { booking } = await api("/api/bookings", { method: "POST", body: formJson(bookingForm) });
      document.querySelector("#booking-result").innerHTML = `<div class="result-card"><strong>Booking created — AHLink does not possess the parcel yet.</strong><code>${escapeHtml(booking.bookingCode)}</code><span>Estimated price: ${money(booking.estimatedPriceCfa)} · Status: ${label(booking.status)}</span></div>`;
      bookingForm.reset();
      await refresh();
      toast("Booking created successfully.");
    } catch (error) { toast(error.message, true); }
  });

  document.querySelector("#acceptance-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await api(`/api/bookings/${encodeURIComponent(form.bookingId.value)}/accept`, { method: "POST", body: formJson(form) });
      document.querySelector("#acceptance-result").innerHTML = `<div class="result-card"><strong>Custody confirmed</strong><code>${escapeHtml(result.parcelPackage.trackingNumber)}</code><span>Final verified price: ${money(result.finalPriceCfa)}. The package can now be placed in origin storage.</span></div>`;
      form.reset();
      form.acceptedBy.value = currentActor();
      await refresh();
      toast("Physical package accepted into custody.");
    } catch (error) { toast(error.message, true); }
  });

  document.querySelector("#tracking-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const trackingNumber = event.currentTarget.trackingNumber.value.trim();
    try {
      const result = await api(`/api/tracking/${encodeURIComponent(trackingNumber)}`);
      renderTracking(result);
    } catch (error) {
      document.querySelector("#tracking-result").innerHTML = `<div class="notice orange">${escapeHtml(error.message)}</div>`;
    }
  });

  const vehicleForm = document.querySelector("#vehicle-form");
  vehicleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/vehicles", { method: "POST", body: formJson(vehicleForm) });
      vehicleForm.reset();
      vehicleForm.vehicleType.value = "Van";
      vehicleForm.capacityPackages.value = "0";
      vehicleForm.capacityKg.value = "0";
      await refresh();
      toast("Vehicle saved.");
    } catch (error) { toast(error.message, true); }
  });

  const tripForm = document.querySelector("#trip-form");
  tripForm.tripDate.value = new Date().toISOString().slice(0, 10);
  tripForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/trips", { method: "POST", body: formJson(tripForm) });
      tripForm.reset();
      tripForm.tripDate.value = new Date().toISOString().slice(0, 10);
      await refresh();
      toast("Trip created.");
    } catch (error) { toast(error.message, true); }
  });
}

function populateOffices() {
  document.querySelectorAll('select[name="origin"], select[name="destination"]').forEach((select) => {
    if (select.options.length) return;
    select.innerHTML = state.offices.map((office) => `<option value="${office.code}" ${select.name === "destination" && office.code === "DLA" ? "selected" : ""}>${office.name}</option>`).join("");
  });
  const accountOptions = `<option value="">Walk-in customer / no account</option>${(state.customerAccounts || []).filter((account) => account.status !== "BLOCKED").map((account) => `<option value="${account.accountId}">${escapeHtml(account.accountName)} · ${escapeHtml(account.accountCode)}</option>`).join("")}`;
  document.querySelectorAll("#booking-account, #acceptance-account").forEach((select) => {
    if (select) select.innerHTML = accountOptions;
  });
}

function renderDashboard() {
  document.querySelector("#metric-awaiting").textContent = state.dashboard.awaitingParcel;
  document.querySelector("#metric-accepted").textContent = state.dashboard.acceptedToday;
  document.querySelector("#metric-stored").textContent = state.dashboard.storedAtOrigin;
  document.querySelector("#metric-trips").textContent = state.dashboard.activeTrips || 0;
  document.querySelector("#recent-packages").innerHTML = packageTable(state.packages.slice(0, 5), false);
}

function renderPickupDispatch() {
  const target = document.querySelector("#pickup-workbench");
  if (!target) return;
  const tasks = state.pickupTasks || [];
  const riderOptions = (state.riders || []).map((rider) => `<option value="${rider.userId}">${escapeHtml(rider.name)} · ${escapeHtml(rider.office)}</option>`).join("");
  target.innerHTML = tasks.length ? `<div class="table-wrap"><table><thead><tr><th>Booking</th><th>Sender / address</th><th>Status</th><th>Rider</th><th>Action</th></tr></thead><tbody>${tasks.map((task) => `<tr>
    <td><strong>${escapeHtml(task.bookingCode)}</strong><br>${task.origin} → ${task.destination}<br><small>${escapeHtml(task.itemDescription)}</small></td>
    <td>${escapeHtml(task.senderName)}<br><small>${escapeHtml(task.senderPhone)}</small><br><small>${escapeHtml(task.pickupAddress)}</small></td>
    <td><span class="badge ${task.status === "ARRIVED_AT_OFFICE" ? "green" : "orange"}">${label(task.status)}</span></td>
    <td>${escapeHtml(task.riderName || "Not assigned")}</td>
    <td>${pickupAction(task, riderOptions)}</td>
  </tr>`).join("")}</tbody></table></div>` : '<div class="empty">No pickup requests yet. Create a booking with “Request pickup” to dispatch a rider.</div>';

  document.querySelectorAll(".pickup-assign-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/pickups/${form.dataset.pickupId}/assign`, { method: "POST", body: formJson(form) });
      await refresh();
      toast("Pickup assigned to rider.");
    } catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll("[data-dispatch-pickup]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/pickups/${button.dataset.dispatchPickup}/dispatch`, { method: "POST", body: { note: "Rider dispatched from office." } });
      await refresh();
      toast("Rider dispatched.");
    } catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll(".pickup-on-way-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/pickups/${form.dataset.pickupId}/on-way`, { method: "POST", body: formJson(form) });
      await refresh();
      toast("Rider marked on the way.");
    } catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll(".pickup-exception-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/pickups/${form.dataset.pickupId}/exception`, { method: "POST", body: formJson(form) });
      await refresh();
      toast("Pickup exception recorded.");
    } catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll(".pickup-collected-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/pickups/${form.dataset.pickupId}/collected`, { method: "POST", body: formJson(form) });
      await refresh();
      toast("Rider pickup confirmed.");
    } catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll(".pickup-arrive-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/pickups/${form.dataset.pickupId}/arrive-office`, { method: "POST", body: formJson(form) });
      await refresh();
      toast("Pickup arrived at origin office. Package can now be accepted.");
    } catch (error) { toast(error.message, true); }
  }));
}

function pickupAction(task, riderOptions) {
  if (task.status === "REQUESTED") {
    return `<form class="pickup-assign-form inline-form" data-pickup-id="${task.pickupTaskId}"><select name="riderUserId" required>${riderOptions || '<option value="">Create an active rider first</option>'}</select><button ${riderOptions ? "" : "disabled"}>Assign rider</button></form>`;
  }
  if (task.status === "ASSIGNED") return `<button data-dispatch-pickup="${task.pickupTaskId}">Dispatch rider</button><form class="pickup-exception-form inline-form" data-pickup-id="${task.pickupTaskId}"><input name="reason" placeholder="Reschedule/fail note" required><select name="outcome"><option value="RESCHEDULED">Reschedule</option><option value="FAILED">Failed</option></select><button>Save</button></form>`;
  if (task.status === "DISPATCHED" || task.status === "RESCHEDULED") return `<form class="pickup-on-way-form inline-form" data-pickup-id="${task.pickupTaskId}"><input name="riderLocationNote" placeholder="Rider location / ETA"><button>On the way</button></form><form class="pickup-exception-form inline-form" data-pickup-id="${task.pickupTaskId}"><input name="reason" placeholder="Reschedule/fail note" required><select name="outcome"><option value="RESCHEDULED">Reschedule</option><option value="FAILED">Failed</option></select><button>Save</button></form>`;
  if (task.status === "ON_THE_WAY") return `<form class="pickup-collected-form inline-form" data-pickup-id="${task.pickupTaskId}"><input name="pickupProofNote" placeholder="Sender handover proof note" required><button>Confirm picked up</button></form><form class="pickup-exception-form inline-form" data-pickup-id="${task.pickupTaskId}"><input name="reason" placeholder="Failed pickup note" required><select name="outcome"><option value="FAILED">Failed</option><option value="RESCHEDULED">Reschedule</option></select><button>Save</button></form>`;
  if (task.status === "FAILED") return `<form class="pickup-exception-form inline-form" data-pickup-id="${task.pickupTaskId}"><input name="reason" placeholder="New schedule note" required><input name="rescheduledFor" type="datetime-local"><select name="outcome"><option value="RESCHEDULED">Reschedule</option></select><button>Reschedule</button></form>`;
  if (task.status === "PICKED_UP") return `<form class="pickup-arrive-form inline-form" data-pickup-id="${task.pickupTaskId}"><input name="officeArrivalNote" placeholder="Office receiver note"><button>Receive at office</button></form>`;
  if (task.status === "ARRIVED_AT_OFFICE") return "Ready for physical acceptance";
  return "—";
}

function renderTripOps() {
  populateTripControls();
  const target = document.querySelector("#trip-workbench");
  if (!target) return;
  const readyPackages = state.packages.filter((item) => item.status === "STORED_AT_ORIGIN");
  const packageOptions = (trip) => readyPackages
    .filter((item) => item.origin === trip.origin && item.destination === trip.destination && !state.manifests.some((manifest) => manifest.packageId === item.packageId && manifest.status !== "REMOVED"))
    .map((item) => `<option value="${item.packageId}">${escapeHtml(item.trackingNumber)} · ${escapeHtml(item.recipientName)} · ${item.verifiedWeightKg}kg</option>`)
    .join("");
  target.innerHTML = state.trips.length ? state.trips.map((trip) => {
    const vehicle = state.vehicles.find((item) => item.vehicleId === trip.vehicleId);
    const items = state.manifests.filter((item) => item.tripId === trip.tripId && item.status !== "REMOVED");
    const options = packageOptions(trip);
    const canDepart = items.length && items.every((item) => item.status === "LOADED") && !["DEPARTED", "ARRIVED", "CANCELLED"].includes(trip.status);
    return `<article class="manifest-card">
      <h3>${escapeHtml(trip.tripCode)} <span class="badge ${trip.status === "DEPARTED" ? "green" : "orange"}">${label(trip.status)}</span></h3>
      <div class="manifest-meta">${escapeHtml(trip.routeName)} · ${trip.origin} → ${trip.destination} · ${escapeHtml(vehicle ? vehicle.registrationNumber : "No vehicle")} · ${items.length} manifest item(s)</div>
      ${["PLANNED", "LOADING"].includes(trip.status) ? `<form class="manifest-add-form manifest-actions" data-trip-id="${trip.tripId}">
        <select name="packageId" required>${options || '<option value="">No stored packages match this route</option>'}</select>
        <button ${options ? "" : "disabled"}>Add to manifest</button>
      </form>
      <form class="manifest-scan-load-form scan-row" data-trip-id="${trip.tripId}">
        <input name="scan" placeholder="Scan package QR to mark loaded" required>
        <button>Load by scan</button>
      </form>` : ""}
      <div class="table-wrap">${manifestTable(trip, items, canDepart)}</div>
      ${canDepart ? `<div class="manifest-actions"><button data-depart-trip="${trip.tripId}">Confirm departure</button></div>` : ""}
    </article>`;
  }).join("") : '<div class="empty">No trips yet. Register a vehicle and create the first trip.</div>';

  document.querySelectorAll(".manifest-add-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/trips/${form.dataset.tripId}/manifest`, { method: "POST", body: formJson(form) });
        await refresh();
        toast("Package added to manifest.");
      } catch (error) { toast(error.message, true); }
    });
  });

  document.querySelectorAll("[data-load-manifest]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const [tripId, manifestItemId] = button.dataset.loadManifest.split("|");
        await api(`/api/trips/${tripId}/manifest/${manifestItemId}/load`, { method: "POST", body: { actor: currentActor() } });
        await refresh();
        toast("Package marked loaded.");
      } catch (error) { toast(error.message, true); }
    });
  });

  document.querySelectorAll(".manifest-scan-load-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/trips/${form.dataset.tripId}/manifest/load-scan`, { method: "POST", body: { scan: form.scan.value, actor: currentActor() } });
        form.reset();
        await refresh();
        toast("Scanned package marked loaded.");
      } catch (error) { toast(error.message, true); }
    });
  });

  document.querySelectorAll("[data-depart-trip]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/trips/${button.dataset.departTrip}/depart`, { method: "POST", body: { actor: currentActor() } });
        await refresh();
        toast("Trip departed. Packages are now in transit.");
      } catch (error) { toast(error.message, true); }
    });
  });
}

function populateTripControls() {
  document.querySelectorAll('#trip-form select[name="origin"], #trip-form select[name="destination"]').forEach((select) => {
    if (select.options.length) return;
    select.innerHTML = state.offices.map((office) => `<option value="${office.code}" ${select.name === "destination" && office.code === "DLA" ? "selected" : ""}>${office.name}</option>`).join("");
  });
  const vehicleSelect = document.querySelector("#trip-vehicle");
  vehicleSelect.innerHTML = state.vehicles.length
    ? `<option value="">Select vehicle</option>${state.vehicles.map((vehicle) => `<option value="${vehicle.vehicleId}">${escapeHtml(vehicle.registrationNumber)} · ${escapeHtml(vehicle.vehicleType)}</option>`).join("")}`
    : '<option value="">Register a vehicle first</option>';
}

function manifestTable(trip, items) {
  if (!items.length) return '<div class="empty">Manifest is empty.</div>';
  return `<table><thead><tr><th>Tracking</th><th>Recipient</th><th>Weight</th><th>Status</th><th>Action</th></tr></thead><tbody>${items.map((item) => `<tr>
    <td><strong>${escapeHtml(item.trackingNumber)}</strong><br>${escapeHtml(item.packageDescription || "")}</td>
    <td>${escapeHtml(item.recipientName || "")}</td>
    <td>${Number(item.weightKg || 0)} kg</td>
    <td><span class="badge ${item.status === "LOADED" ? "green" : "orange"}">${label(item.status)}</span></td>
    <td>${item.status === "PENDING" && ["PLANNED", "LOADING"].includes(trip.status) ? `<button data-load-manifest="${trip.tripId}|${item.manifestItemId}">Mark loaded</button>` : "—"}</td>
  </tr>`).join("")}</tbody></table>`;
}

function renderDestinationOps() {
  const reception = document.querySelector("#destination-reception");
  const destinationPackages = document.querySelector("#destination-packages");
  if (!reception || !destinationPackages) return;
  const departedTrips = state.trips.filter((trip) => trip.status === "DEPARTED");
  reception.innerHTML = departedTrips.length ? departedTrips.map((trip) => {
    const items = state.manifests.filter((item) => item.tripId === trip.tripId && item.status !== "REMOVED");
    return `<article class="manifest-card"><h3>${escapeHtml(trip.tripCode)}</h3><div class="manifest-meta">${trip.origin} → ${trip.destination} · ${items.length} package(s)</div>
      <form class="receive-scan-form scan-row" data-trip-id="${trip.tripId}">
        <input name="scan" placeholder="Scan package QR at destination" required>
        <select name="report"><option value="ARRIVED">Arrived</option><option value="MISSING">Missing</option><option value="DAMAGED">Damaged</option><option value="WRONG_DESTINATION">Wrong destination</option></select>
        <input name="note" placeholder="Optional note">
        <button>Receive scan</button>
      </form>
      <form class="receive-trip-form" data-trip-id="${trip.tripId}">
        <table><thead><tr><th>Tracking</th><th>Recipient</th><th>Reception result</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.trackingNumber)}</td><td>${escapeHtml(item.recipientName)}</td><td><select name="${item.manifestItemId}"><option value="ARRIVED">Arrived</option><option value="MISSING">Missing</option><option value="DAMAGED">Damaged</option><option value="WRONG_DESTINATION">Wrong destination</option></select></td></tr>`).join("")}</tbody></table>
        <label>Reception note<input name="note" placeholder="Optional note"></label>
        <button class="primary">Receive trip</button>
      </form></article>`;
  }).join("") : '<div class="empty">No departed trips awaiting destination reception.</div>';

  document.querySelectorAll(".receive-trip-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const reports = {};
    Array.from(form.elements).forEach((element) => { if (element.tagName === "SELECT") reports[element.name] = element.value; });
    try {
      await api(`/api/trips/${form.dataset.tripId}/receive`, { method: "POST", body: { actor: currentActor(), reports, note: form.note.value } });
      await refresh();
      toast("Trip received at destination.");
    } catch (error) { toast(error.message, true); }
  }));

  document.querySelectorAll(".receive-scan-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/trips/${form.dataset.tripId}/receive-scan`, { method: "POST", body: { scan: form.scan.value, report: form.report.value, note: form.note.value, actor: currentActor() } });
      form.reset();
      await refresh();
      toast("Destination scan received.");
    } catch (error) { toast(error.message, true); }
  }));

  const arrived = state.packages.filter((item) => ["ARRIVED_AT_DESTINATION", "STORED_AT_DESTINATION"].includes(item.status));
  destinationPackages.innerHTML = arrived.length ? `<table><thead><tr><th>Tracking</th><th>Recipient</th><th>Status</th><th>PIN</th><th>Action</th></tr></thead><tbody>${arrived.map((item) => `<tr>
    <td><strong>${escapeHtml(item.trackingNumber)}</strong><br>${item.origin} → ${item.destination}</td>
    <td>${escapeHtml(item.recipientName)}<br><small>${escapeHtml(item.recipientPhone)}</small></td>
    <td><span class="badge ${item.status === "STORED_AT_DESTINATION" ? "green" : "orange"}">${label(item.status)}</span></td>
    <td>${escapeHtml(item.pickupPin || "—")}</td>
    <td>${item.status === "ARRIVED_AT_DESTINATION" ? `<form class="destination-store-form" data-package-id="${item.packageId}"><input name="storageLocation" placeholder="DLA-SHELF-A01" required><button>Store</button></form>` : `<form class="collect-form" data-package-id="${item.packageId}"><input name="pickupPin" placeholder="PIN" required><input name="receiverName" value="${escapeHtml(item.recipientName)}" required><input name="receiverPhone" value="${escapeHtml(item.recipientPhone)}" required><input name="idNote" placeholder="ID note"><button>Collect</button></form>`}</td>
  </tr>`).join("")}</tbody></table>` : '<div class="empty">No destination packages awaiting storage or collection.</div>';

  document.querySelectorAll(".destination-store-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/packages/${form.dataset.packageId}/destination-store`, { method: "POST", body: { storageLocation: form.storageLocation.value, actor: currentActor() } });
      await refresh();
      toast("Destination storage recorded.");
    } catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll(".collect-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/packages/${form.dataset.packageId}/collect`, { method: "POST", body: { pickupPin: form.pickupPin.value, receiverName: form.receiverName.value, receiverPhone: form.receiverPhone.value, idNote: form.idNote.value, actor: currentActor() } });
      await refresh();
      toast("Package collection verified.");
    } catch (error) { toast(error.message, true); }
  }));
}

function renderExceptions() {
  const target = document.querySelector("#exception-workbench");
  if (!target) return;
  const candidates = state.packages.filter((item) => !["COLLECTED"].includes(item.status));
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Package</th><th>Status</th><th>Record exception</th></tr></thead><tbody>${candidates.map((item) => `<tr><td><strong>${escapeHtml(item.trackingNumber)}</strong><br>${escapeHtml(item.recipientName)}</td><td><span class="badge orange">${label(item.status)}</span></td><td><form class="exception-form" data-package-id="${item.packageId}"><select name="exceptionType"><option value="DAMAGED">Damaged</option><option value="MISSING">Missing</option><option value="WRONG_DESTINATION">Wrong destination</option><option value="REFUSED_COLLECTION">Refused collection</option><option value="RETURN_TO_ORIGIN">Return to origin</option></select><input name="note" placeholder="Required note" required><button>Record</button></form></td></tr>`).join("") || '<tr><td colspan="3">No packages available.</td></tr>'}</tbody></table></div>
  <h3>Exception log</h3><div class="table-wrap"><table><thead><tr><th>Time</th><th>Type</th><th>Package</th><th>Note</th></tr></thead><tbody>${state.exceptions.map((row) => `<tr><td>${formatDate(row.createdAt)}</td><td>${label(row.exceptionType)}</td><td>${escapeHtml(packageTracking(row.packageId))}</td><td>${escapeHtml(row.note)}</td></tr>`).join("") || '<tr><td colspan="4">No exceptions recorded.</td></tr>'}</tbody></table></div>`;
  document.querySelectorAll(".exception-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parcelPackage = state.packages.find((item) => item.packageId === form.dataset.packageId);
    try {
      await api(`/api/packages/${form.dataset.packageId}/exception`, { method: "POST", body: { exceptionType: form.exceptionType.value, note: form.note.value, office: parcelPackage.currentOffice, actor: currentActor() } });
      await refresh();
      toast("Exception recorded.");
    } catch (error) { toast(error.message, true); }
  }));
}

function renderFinance() {
  const summary = document.querySelector("#finance-summary");
  const target = document.querySelector("#finance-workbench");
  if (!summary || !target) return;
  const finance = state.finance || {};
  const openShift = (state.cashierShifts || []).find((shift) => shift.status === "OPEN" && (!session || shift.cashierUserId === session.userId));
  summary.innerHTML = `<div class="metric-grid"><article class="metric"><span>Collected today</span><strong>${money(finance.totalCollectedCfa)}</strong><small>${finance.paymentCount || 0} payment(s)</small></article><article class="metric"><span>Outstanding</span><strong>${money(finance.outstandingCfa)}</strong><small>${finance.outstandingCount || 0} package(s)</small></article><article class="metric"><span>Cash</span><strong>${money((finance.byMode || {}).CASH)}</strong><small>Today</small></article><article class="metric"><span>MoMo</span><strong>${money((finance.byMode || {}).MOMO)}</strong><small>Today</small></article></div>
  <div class="finance-tools"><form id="shift-start-form" class="inline-form"><input name="openingFloatCfa" type="number" min="0" value="0" placeholder="Opening float"><input name="note" placeholder="Shift note"><button ${openShift ? "disabled" : ""}>Start cashier shift</button></form>
  ${openShift ? `<form id="shift-close-form" class="inline-form" data-shift-id="${openShift.shiftId}"><input name="countedCashCfa" type="number" min="0" required placeholder="Counted cash"><input name="note" placeholder="Closing note"><button>Close shift</button></form>` : '<div class="notice orange">No open shift for this cashier. Start a shift before recording cashier accountability.</div>'}
  <div class="manifest-actions"><button id="print-cashier-report">Print cashier report</button><button id="export-cashier-report">Export CSV</button></div></div>`;
  const unpaid = state.packages.filter((item) => item.paymentStatus !== "PAID");
  target.innerHTML = `<h3>Record package payment</h3><div class="table-wrap"><table><thead><tr><th>Package</th><th>Due</th><th>Arrangement</th><th>Payment</th></tr></thead><tbody>${unpaid.map((item) => {
    const due = Math.max(0, Number(item.finalPriceCfa || 0) - Number(item.paidCfa || 0));
    return `<tr><td><strong>${escapeHtml(item.trackingNumber)}</strong><br>${escapeHtml(item.recipientName)}</td><td>${money(due)}</td><td>${label(item.paymentArrangement)}</td><td><form class="payment-form" data-package-id="${item.packageId}"><input name="amountCfa" type="number" min="1" value="${due}" required><select name="mode"><option>CASH</option><option>MOMO</option><option>ACCOUNT</option></select><select name="payerType"><option>RECIPIENT</option><option>SENDER</option><option>ACCOUNT</option></select><button>Record</button></form></td></tr>`;
  }).join("") || '<tr><td colspan="4">No outstanding package payments.</td></tr>'}</tbody></table></div>
  <h3>Outstanding by account</h3><div class="pill-list">${Object.entries(finance.outstandingByAccount || {}).map(([name, amount]) => `<span>${escapeHtml(name)}: <strong>${money(amount)}</strong></span>`).join("") || "No account balances."}</div>
  <h3>Cash closings</h3><div class="table-wrap"><table><thead><tr><th>Closed</th><th>Cashier</th><th>Expected</th><th>Counted</th><th>Variance</th></tr></thead><tbody>${(state.cashClosings || []).map((row) => `<tr><td>${formatDate(row.closedAt)}</td><td>${escapeHtml(row.cashierName)}</td><td>${money(row.expectedCashCfa)}</td><td>${money(row.countedCashCfa)}</td><td>${money(row.varianceCfa)}</td></tr>`).join("") || '<tr><td colspan="5">No cash closings yet.</td></tr>'}</tbody></table></div>
  <h3>Payment log</h3><div class="table-wrap"><table><thead><tr><th>Time</th><th>Package</th><th>Amount</th><th>Mode</th><th>Payer</th><th>Cashier</th></tr></thead><tbody>${state.payments.map((row) => `<tr><td>${formatDate(row.paidAt)}</td><td>${escapeHtml(row.trackingNumber)}</td><td>${money(row.amountCfa)}</td><td>${escapeHtml(row.mode)}</td><td>${escapeHtml(row.payerType)}</td><td>${escapeHtml(row.receivedBy)}</td></tr>`).join("") || '<tr><td colspan="6">No payments recorded today.</td></tr>'}</tbody></table></div>`;
  const shiftStart = document.querySelector("#shift-start-form");
  if (shiftStart) shiftStart.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/finance/shifts/start", { method: "POST", body: formJson(shiftStart) });
      await refresh();
      toast("Cashier shift started.");
    } catch (error) { toast(error.message, true); }
  });
  const shiftClose = document.querySelector("#shift-close-form");
  if (shiftClose) shiftClose.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/finance/shifts/${shiftClose.dataset.shiftId}/close`, { method: "POST", body: formJson(shiftClose) });
      await refresh();
      toast("Cashier shift closed.");
    } catch (error) { toast(error.message, true); }
  });
  document.querySelector("#print-cashier-report")?.addEventListener("click", printCashierReport);
  document.querySelector("#export-cashier-report")?.addEventListener("click", () => {
    window.open(`/api/finance/report.csv?date=${encodeURIComponent(new Date().toISOString().slice(0, 10))}`, "_blank");
  });
  document.querySelectorAll(".payment-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/packages/${form.dataset.packageId}/payments`, { method: "POST", body: { amountCfa: form.amountCfa.value, mode: form.mode.value, payerType: form.payerType.value, receivedBy: currentActor() } });
      await refresh();
      toast("Payment recorded.");
    } catch (error) { toast(error.message, true); }
  }));
}

function renderAccounts() {
  const target = document.querySelector("#accounts-workbench");
  if (!target) return;
  const balances = (state.finance && state.finance.accountBalances) || [];
  target.innerHTML = `<div class="two-panel-grid">
    <form id="account-form" class="sub-panel">
      <h3>Create / edit customer account</h3>
      <input name="accountId" type="hidden">
      <label>Account code<input name="accountCode" placeholder="BIZ-001"></label>
      <label>Account name<input name="accountName" required placeholder="Business or customer name"></label>
      <label>Contact person<input name="contactName" required placeholder="Manager / owner"></label>
      <label>Phone<input name="phone" required></label>
      <label>Type<select name="accountType"><option value="BUSINESS">Business</option><option value="INDIVIDUAL">Individual</option></select></label>
      <label>Credit limit FCFA<input name="creditLimitCfa" type="number" min="0" value="0"></label>
      <label>Status<select name="status"><option value="ACTIVE">Active</option><option value="BLOCKED">Blocked</option></select></label>
      <label>Note<input name="note" placeholder="Optional billing note"></label>
      <button class="primary full-button">Save account</button>
    </form>
    <div class="sub-panel">
      <h3>Account balance controls</h3>
      <p>Use account billing when accepting packages, then receive account payments here. Statements can be printed for business customers.</p>
      <div class="pill-list">${balances.map((row) => `<span>${escapeHtml(row.accountName)}: <strong>${money(row.outstandingCfa)}</strong></span>`).join("") || "No account balances yet."}</div>
    </div>
  </div>
  <h3>Customer / business accounts</h3>
  <div class="table-wrap"><table><thead><tr><th>Account</th><th>Contact</th><th>Credit</th><th>Outstanding</th><th>Status</th><th>Actions</th></tr></thead><tbody>${(state.customerAccounts || []).map((account) => {
    const balance = balances.find((row) => row.accountId === account.accountId) || {};
    return `<tr>
      <td><strong>${escapeHtml(account.accountName)}</strong><br><small>${escapeHtml(account.accountCode)} · ${label(account.accountType)}</small></td>
      <td>${escapeHtml(account.contactName)}<br><small>${escapeHtml(account.phone)}</small></td>
      <td>${money(account.creditLimitCfa)}<br><small>Available: ${money(balance.availableCreditCfa)}</small></td>
      <td>${money(balance.outstandingCfa)}</td>
      <td><span class="badge ${account.status === "ACTIVE" ? "green" : "orange"}">${label(account.status)}</span></td>
      <td><button data-edit-account="${account.accountId}">Edit</button><button data-print-statement="${account.accountId}">Print statement</button><form class="account-payment-form inline-form" data-account-id="${account.accountId}"><input name="amountCfa" type="number" min="1" placeholder="Amount" required><select name="mode"><option value="CASH">Cash</option><option value="MOMO">MoMo</option><option value="BANK">Bank</option></select><button>Receive</button></form></td>
    </tr>`;
  }).join("") || '<tr><td colspan="6">No customer accounts yet.</td></tr>'}</tbody></table></div>`;

  document.querySelector("#account-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/customers", { method: "POST", body: formJson(event.currentTarget) });
      event.currentTarget.reset();
      await refresh();
      toast("Customer account saved.");
    } catch (error) { toast(error.message, true); }
  });
  document.querySelectorAll("[data-edit-account]").forEach((button) => button.addEventListener("click", () => {
    const account = state.customerAccounts.find((row) => row.accountId === button.dataset.editAccount);
    const form = document.querySelector("#account-form");
    if (!account || !form) return;
    form.accountId.value = account.accountId;
    form.accountCode.value = account.accountCode;
    form.accountName.value = account.accountName;
    form.contactName.value = account.contactName;
    form.phone.value = account.phone;
    form.accountType.value = account.accountType;
    form.creditLimitCfa.value = account.creditLimitCfa || 0;
    form.status.value = account.status || "ACTIVE";
    form.note.value = account.note || "";
    showView("accounts");
  }));
  document.querySelectorAll("[data-print-statement]").forEach((button) => button.addEventListener("click", () => printAccountStatement(button.dataset.printStatement)));
  document.querySelectorAll(".account-payment-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/customers/${encodeURIComponent(form.dataset.accountId)}/payments`, { method: "POST", body: formJson(form) });
      await refresh();
      toast("Account payment recorded.");
    } catch (error) { toast(error.message, true); }
  }));
}

function renderNotifications() {
  const target = document.querySelector("#notification-workbench");
  if (!target) return;
  const activeTrips = state.trips.filter((trip) => ["LOADING", "DEPARTED", "ARRIVED"].includes(trip.status));
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Package</th><th>Status</th><th>Customer message</th><th>Print / scan</th></tr></thead><tbody>${state.packages.map((item) => `<tr>
    <td><strong>${escapeHtml(item.trackingNumber)}</strong><br>${escapeHtml(item.senderName)} → ${escapeHtml(item.recipientName)}</td>
    <td><span class="badge ${item.status === "COLLECTED" ? "green" : "orange"}">${label(item.status)}</span></td>
    <td><textarea readonly rows="4">${escapeHtml(notificationTemplate(item))}</textarea></td>
    <td><div class="manifest-actions"><button data-copy-message="${item.packageId}">Copy message</button><button data-print-label="${item.packageId}">Print label</button><button data-print-receipt="${item.packageId}">Print receipt</button></div></td>
  </tr>`).join("") || '<tr><td colspan="4">No packages yet.</td></tr>'}</tbody></table></div>
  <h3>Trip manifests</h3><div class="manifest-actions">${activeTrips.map((trip) => `<button data-print-manifest="${trip.tripId}">Print ${escapeHtml(trip.tripCode)}</button>`).join("") || "No active manifests to print."}</div>`;

  document.querySelectorAll("[data-copy-message]").forEach((button) => button.addEventListener("click", async () => {
    const item = state.packages.find((row) => row.packageId === button.dataset.copyMessage);
    await navigator.clipboard.writeText(notificationTemplate(item));
    toast("Message copied.");
  }));
  document.querySelectorAll("[data-print-label]").forEach((button) => button.addEventListener("click", () => printPackageLabel(button.dataset.printLabel)));
  document.querySelectorAll("[data-print-receipt]").forEach((button) => button.addEventListener("click", () => printReceipt(button.dataset.printReceipt)));
  document.querySelectorAll("[data-print-manifest]").forEach((button) => button.addEventListener("click", () => printManifest(button.dataset.printManifest)));
}

function notificationTemplate(item) {
  if (!item) return "";
  if (item.status === "ARRIVED_AT_DESTINATION" || item.status === "STORED_AT_DESTINATION") {
    return `Hello ${item.recipientName}, your AHLink Express package ${item.trackingNumber} has arrived at ${item.destination}. Pickup PIN: ${item.pickupPin || "pending"}. Please come with ID for collection.`;
  }
  if (item.status === "IN_TRANSIT") return `Hello ${item.recipientName}, your AHLink Express package ${item.trackingNumber} is in transit from ${item.origin} to ${item.destination}.`;
  if (item.status === "COLLECTED") return `Hello ${item.recipientName}, package ${item.trackingNumber} has been collected. Thank you for using AHLink Express.`;
  if (item.status === "EXCEPTION") return `Hello, AHLink Express has recorded an issue on package ${item.trackingNumber}: ${item.exceptionType || "Exception"}. Our office will follow up.`;
  return `Hello ${item.recipientName}, AHLink Express package ${item.trackingNumber} is currently ${label(item.status)}.`;
}

function openPrint(title, html) {
  const popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) return toast("Allow popups to print.", true);
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>body{font-family:Arial;padding:24px;color:#172033}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccd;padding:8px;text-align:left}.barcode{font-family:monospace;font-size:24px;letter-spacing:2px;border:2px solid #111;padding:12px;display:inline-block}.qr{width:96px;height:96px;border:8px solid #111;display:grid;place-items:center;font-size:10px;text-align:center}</style></head><body>${html}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
  popup.document.close();
}

function printPackageLabel(packageId) {
  const item = state.packages.find((row) => row.packageId === packageId);
  if (!item) return;
  openPrint(`Label ${item.trackingNumber}`, `<h1>AHLink Express Package Label</h1><div class="barcode">${escapeHtml(item.trackingNumber)}</div><p><b>Route:</b> ${item.origin} → ${item.destination}</p><p><b>Recipient:</b> ${escapeHtml(item.recipientName)} / ${escapeHtml(item.recipientPhone)}</p><p><b>Description:</b> ${escapeHtml(item.itemDescription)}</p><img alt="QR code" src="/api/packages/${encodeURIComponent(item.packageId)}/qr.svg" style="width:160px;height:160px"><p>Scan QR to load, receive or track this package.</p>`);
}

function printReceipt(packageId) {
  const item = state.packages.find((row) => row.packageId === packageId);
  if (!item) return;
  openPrint(`Receipt ${item.trackingNumber}`, `<h1>AHLink Express Receipt</h1><p><b>Tracking:</b> ${escapeHtml(item.trackingNumber)}</p><p><b>Sender:</b> ${escapeHtml(item.senderName)} / ${escapeHtml(item.senderPhone)}</p><p><b>Recipient:</b> ${escapeHtml(item.recipientName)} / ${escapeHtml(item.recipientPhone)}</p><p><b>Route:</b> ${item.origin} → ${item.destination}</p><p><b>Fee:</b> ${money(item.finalPriceCfa)}</p><p><b>Payment:</b> ${label(item.paymentStatus)} (${money(item.paidCfa)})</p><p><b>Status:</b> ${label(item.status)}</p>`);
}

function printManifest(tripId) {
  const trip = state.trips.find((row) => row.tripId === tripId);
  const items = state.manifests.filter((row) => row.tripId === tripId && row.status !== "REMOVED");
  if (!trip) return;
  openPrint(`Manifest ${trip.tripCode}`, `<h1>AHLink Express Trip Manifest</h1><p><b>${escapeHtml(trip.tripCode)}</b> · ${trip.origin} → ${trip.destination} · ${label(trip.status)}</p><table><thead><tr><th>Tracking</th><th>Recipient</th><th>Weight</th><th>Status</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.trackingNumber)}</td><td>${escapeHtml(item.recipientName)}</td><td>${Number(item.weightKg || 0)} kg</td><td>${label(item.status)}</td></tr>`).join("")}</tbody></table>`);
}

function printCashierReport() {
  const finance = state.finance || {};
  openPrint("Daily cashier report", `<h1>AHLink Express Daily Cashier Report</h1><p><b>Date:</b> ${escapeHtml(finance.date || new Date().toISOString().slice(0, 10))}</p><table><tbody><tr><th>Total collected</th><td>${money(finance.totalCollectedCfa)}</td></tr><tr><th>Payment count</th><td>${Number(finance.paymentCount || 0)}</td></tr><tr><th>Outstanding</th><td>${money(finance.outstandingCfa)}</td></tr><tr><th>Cash</th><td>${money((finance.byMode || {}).CASH)}</td></tr><tr><th>MoMo</th><td>${money((finance.byMode || {}).MOMO)}</td></tr><tr><th>Account</th><td>${money((finance.byMode || {}).ACCOUNT)}</td></tr></tbody></table><h2>Cash closings</h2><table><thead><tr><th>Cashier</th><th>Expected</th><th>Counted</th><th>Variance</th></tr></thead><tbody>${(state.cashClosings || []).map((row) => `<tr><td>${escapeHtml(row.cashierName)}</td><td>${money(row.expectedCashCfa)}</td><td>${money(row.countedCashCfa)}</td><td>${money(row.varianceCfa)}</td></tr>`).join("") || '<tr><td colspan="4">No closings.</td></tr>'}</tbody></table>`);
}

function printAccountStatement(accountId) {
  const account = state.customerAccounts.find((row) => row.accountId === accountId);
  if (!account) return;
  const packages = state.packages.filter((item) => item.customerAccountId === accountId);
  const payments = state.payments.filter((item) => item.accountId === accountId);
  const balance = ((state.finance || {}).accountBalances || []).find((row) => row.accountId === accountId) || {};
  openPrint(`Statement ${account.accountCode}`, `<h1>AHLink Express Account Statement</h1><p><b>${escapeHtml(account.accountName)}</b> · ${escapeHtml(account.accountCode)} · ${escapeHtml(account.phone)}</p><p><b>Outstanding:</b> ${money(balance.outstandingCfa)} · <b>Credit limit:</b> ${money(account.creditLimitCfa)}</p><h2>Account-billed packages</h2><table><thead><tr><th>Tracking</th><th>Route</th><th>Status</th><th>Charge</th><th>Paid</th></tr></thead><tbody>${packages.map((item) => `<tr><td>${escapeHtml(item.trackingNumber)}</td><td>${item.origin} → ${item.destination}</td><td>${label(item.status)}</td><td>${money(item.finalPriceCfa)}</td><td>${money(item.paidCfa)}</td></tr>`).join("") || '<tr><td colspan="5">No account packages.</td></tr>'}</tbody></table><h2>Account payments</h2><table><thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Received by</th></tr></thead><tbody>${payments.map((payment) => `<tr><td>${formatDate(payment.paidAt)}</td><td>${money(payment.amountCfa)}</td><td>${label(payment.mode)}</td><td>${escapeHtml(payment.receivedBy)}</td></tr>`).join("") || '<tr><td colspan="4">No account payments.</td></tr>'}</tbody></table>`);
}

function renderAdmin() {
  const target = document.querySelector("#admin-workbench");
  if (!target) return;
  const roleOptions = (state.roles || []).map((role) => `<option value="${role}">${label(role)}</option>`).join("");
  const officeOptions = (state.officeSettings || state.offices || []).map((office) => `<option value="${office.code}">${escapeHtml(office.name)} (${office.code})</option>`).join("");
  target.innerHTML = `<div class="two-panel-grid">
    <form id="staff-form" class="sub-panel">
      <h3>Create / edit staff</h3>
      <label>User ID<input name="userId" required placeholder="origin2"></label>
      <label>Name<input name="name" required placeholder="Staff name"></label>
      <label>Role<select name="role" required>${roleOptions}</select></label>
      <label>Office<select name="office" required>${officeOptions}</select></label>
      <label>PIN<input name="pin" placeholder="Required for new staff"></label>
      <label>Status<select name="isActive"><option value="true">Active</option><option value="false">Inactive</option></select></label>
      <button class="primary full-button">Save staff</button>
    </form>
    <form id="office-form" class="sub-panel">
      <h3>Office setting</h3>
      <label>Code<select name="code">${officeOptions}</select></label>
      <label>Name<input name="name" required placeholder="Office name"></label>
      <label>Status<select name="isActive"><option value="true">Active</option><option value="false">Inactive</option></select></label>
      <button class="primary full-button">Save office</button>
    </form>
  </div>
  <div class="two-panel-grid">
    <form id="route-form" class="sub-panel">
      <h3>Route setting</h3>
      <label>Origin<select name="origin" required>${officeOptions}</select></label>
      <label>Destination<select name="destination" required>${officeOptions}</select></label>
      <label>Route name<input name="name" placeholder="Buea to Douala"></label>
      <label>Base price FCFA<input name="basePriceCfa" type="number" min="0" required value="0"></label>
      <label>Status<select name="isActive"><option value="true">Active</option><option value="false">Inactive</option></select></label>
      <button class="primary full-button">Save route</button>
    </form>
    <form id="company-form" class="sub-panel">
      <h3>Basic company settings</h3>
      <label>Company name<input name="companyName" required value="${escapeHtml((state.companySettings || {}).companyName || "AHLink Express")}"></label>
      <label>Company phone<input name="phone" value="${escapeHtml((state.companySettings || {}).phone || "")}"></label>
      <label>Public tracking base URL<input name="trackingBaseUrl" placeholder="https://ahlink-express-os.onrender.com/track" value="${escapeHtml((state.companySettings || {}).trackingBaseUrl || "")}"></label>
      <label>Receipt footer<input name="receiptFooter" value="${escapeHtml((state.companySettings || {}).receiptFooter || "")}"></label>
      <button class="primary full-button">Save company settings</button>
    </form>
  </div>
  <div class="two-panel-grid">
    <div class="sub-panel">
      <h3>Staff activity</h3>
      <div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Actor</th></tr></thead><tbody>${(state.auditLogs || []).slice(0, 8).map((row) => `<tr><td>${formatDate(row.createdAt)}</td><td>${label(row.action)}</td><td>${escapeHtml(row.actorName)}</td></tr>`).join("") || '<tr><td colspan="3">No activity yet.</td></tr>'}</tbody></table></div>
    </div>
  </div>
  <h3>Staff users</h3><div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Office</th><th>Status</th><th>Actions</th></tr></thead><tbody>${(state.users || []).map((user) => `<tr><td><strong>${escapeHtml(user.userId)}</strong><br>${escapeHtml(user.name)}</td><td>${label(user.role)}</td><td>${escapeHtml(user.office)}</td><td><span class="badge ${user.isActive ? "green" : "orange"}">${user.isActive ? "Active" : "Inactive"}</span></td><td><form class="pin-reset-form inline-form" data-user-id="${user.userId}"><input name="pin" placeholder="New PIN" required><button>Reset PIN</button></form><button data-edit-user="${user.userId}">Edit</button>${user.isActive ? `<button data-deactivate-user="${user.userId}">Deactivate</button>` : `<button data-reactivate-user="${user.userId}">Reactivate</button>`}</td></tr>`).join("") || '<tr><td colspan="5">No staff users.</td></tr>'}</tbody></table></div>
  <h3>Routes</h3><div class="table-wrap"><table><thead><tr><th>Route</th><th>Name</th><th>Base price</th><th>Status</th><th>Action</th></tr></thead><tbody>${(state.routeSettings || []).map((route) => `<tr><td>${route.origin} → ${route.destination}</td><td>${escapeHtml(route.name)}</td><td>${money(route.basePriceCfa)}</td><td>${route.isActive ? "Active" : "Inactive"}</td><td><button data-edit-route="${route.routeId}">Edit</button></td></tr>`).join("")}</tbody></table></div>`;

  document.querySelector("#staff-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/users", { method: "POST", body: formJson(event.currentTarget) });
      event.currentTarget.reset();
      await refresh();
      toast("Staff user saved.");
    } catch (error) { toast(error.message, true); }
  });
  document.querySelector("#office-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/offices", { method: "POST", body: formJson(event.currentTarget) });
      await refresh();
      toast("Office saved.");
    } catch (error) { toast(error.message, true); }
  });
  document.querySelector("#route-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/routes", { method: "POST", body: formJson(event.currentTarget) });
      await refresh();
      toast("Route saved.");
    } catch (error) { toast(error.message, true); }
  });
  document.querySelector("#company-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/company", { method: "POST", body: formJson(event.currentTarget) });
      await refresh();
      toast("Company settings saved.");
    } catch (error) { toast(error.message, true); }
  });
  document.querySelectorAll(".pin-reset-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/users/${encodeURIComponent(form.dataset.userId)}/pin`, { method: "POST", body: formJson(form) });
      await refresh();
      toast("PIN reset.");
    } catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll("[data-deactivate-user]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/admin/users/${encodeURIComponent(button.dataset.deactivateUser)}/deactivate`, { method: "POST" });
      await refresh();
      toast("Staff user deactivated.");
    } catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll("[data-reactivate-user]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/admin/users/${encodeURIComponent(button.dataset.reactivateUser)}/reactivate`, { method: "POST" });
      await refresh();
      toast("Staff user reactivated.");
    } catch (error) { toast(error.message, true); }
  }));
  document.querySelectorAll("[data-edit-user]").forEach((button) => button.addEventListener("click", () => {
    const user = state.users.find((row) => row.userId === button.dataset.editUser);
    const form = document.querySelector("#staff-form");
    if (!user || !form) return;
    form.userId.value = user.userId;
    form.name.value = user.name;
    form.role.value = user.role;
    form.office.value = user.office;
    form.isActive.value = String(user.isActive !== false);
  }));
  document.querySelectorAll("[data-edit-route]").forEach((button) => button.addEventListener("click", () => {
    const route = state.routeSettings.find((row) => row.routeId === button.dataset.editRoute);
    const form = document.querySelector("#route-form");
    if (!route || !form) return;
    form.origin.value = route.origin;
    form.destination.value = route.destination;
    form.name.value = route.name;
    form.basePriceCfa.value = route.basePriceCfa;
    form.isActive.value = String(route.isActive !== false);
  }));
}

function renderAudit() {
  const target = document.querySelector("#audit-workbench");
  if (!target) return;
  const logs = state.auditLogs || [];
  target.innerHTML = logs.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Office</th><th>Details</th></tr></thead><tbody>${logs.map((row) => `<tr>
    <td>${formatDate(row.createdAt)}</td>
    <td><span class="badge green">${label(row.action)}</span></td>
    <td>${escapeHtml(row.actorName)}<br><small>${label(row.role)}</small></td>
    <td>${escapeHtml(row.office)}</td>
    <td><code>${escapeHtml(auditDetails(row.details))}</code></td>
  </tr>`).join("")}</tbody></table></div>` : '<div class="empty">No audit events yet. Create a booking or receive a package to begin the trail.</div>';
}

function renderAcceptanceOptions() {
  const available = state.bookings.filter((booking) => ["AWAITING_DROPOFF", "PICKUP_REQUESTED", "PICKUP_ARRIVED_AT_OFFICE"].includes(booking.status));
  const select = document.querySelector("#acceptance-booking");
  select.innerHTML = available.length
    ? `<option value="">Select booking…</option>${available.map((booking) => `<option value="${booking.bookingId}">${escapeHtml(booking.bookingCode)} · ${escapeHtml(booking.senderName)} · ${booking.origin}→${booking.destination} · ${label(booking.status)}</option>`).join("")}`
    : '<option value="">No bookings awaiting a package</option>';
}

function renderInventory() {
  document.querySelector("#inventory-table").innerHTML = packageTable(state.packages, true);
  document.querySelectorAll(".storage-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/packages/${form.dataset.packageId}/store`, { method: "POST", body: { storageLocation: form.storageLocation.value, actor: currentActor() } });
        await refresh();
        toast("Storage location recorded.");
      } catch (error) { toast(error.message, true); }
    });
  });
}

function packageTable(packages, storageActions) {
  if (!packages.length) return '<div class="empty">No physical packages have been accepted yet.</div>';
  return `<table><thead><tr><th>Tracking</th><th>Route</th><th>Recipient</th><th>Status</th><th>Storage</th><th>Verified price</th></tr></thead><tbody>${packages.map((item) => `<tr><td><strong>${escapeHtml(item.trackingNumber)}</strong></td><td>${item.origin} → ${item.destination}</td><td>${escapeHtml(item.recipientName)}</td><td><span class="badge ${item.status === "STORED_AT_ORIGIN" ? "green" : "orange"}">${label(item.status)}</span></td><td>${item.storageLocation ? escapeHtml(item.storageLocation) : storageActions ? `<form class="storage-form" data-package-id="${item.packageId}"><input name="storageLocation" placeholder="BUE-DLA-A01" required><button>Store</button></form>` : "Not stored"}</td><td>${money(item.finalPriceCfa)}</td></tr>`).join("")}</tbody></table>`;
}

function renderTracking(result) {
  const item = result.package;
  document.querySelector("#tracking-result").innerHTML = `<div class="result-card"><strong>${escapeHtml(item.trackingNumber)}</strong><p>${escapeHtml(item.senderName)} → ${escapeHtml(item.recipientName)} · ${item.origin} to ${item.destination}</p><span class="badge green">${label(item.status)}</span>${item.storageLocation ? `<p>Current physical location: <b>${escapeHtml(item.currentOffice)} / ${escapeHtml(item.storageLocation)}</b></p>` : ""}</div><ul class="timeline">${result.events.map((event) => `<li><strong>${label(event.type)}</strong><small>${formatDate(event.createdAt)} · ${escapeHtml(event.office)} · ${escapeHtml(event.actor)}</small><small>${escapeHtml(event.note)}</small></li>`).join("")}</ul>`;
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(sessionToken && options.auth !== false ? { "X-AHLink-Session": sessionToken } : {}), ...(options.headers || {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function formJson(form) { return Object.fromEntries(new FormData(form).entries()); }
function packageTracking(packageId) { return (state.packages.find((item) => item.packageId === packageId) || {}).trackingNumber || packageId; }
function auditDetails(details) { return Object.entries(details || {}).map(([key, value]) => `${key}: ${value}`).join(" · "); }
function money(value) { return `${Number(value || 0).toLocaleString("en-US")} FCFA`; }
function label(value) { return String(value || "").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function escapeHtml(value) { const span = document.createElement("span"); span.textContent = String(value ?? ""); return span.innerHTML; }
function toast(message, error = false) { const element = document.querySelector("#toast"); element.textContent = message; element.classList.toggle("error", error); element.classList.add("show"); setTimeout(() => element.classList.remove("show"), 3200); }
