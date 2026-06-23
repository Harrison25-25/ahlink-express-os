import fs from "node:fs";
import path from "node:path";

const EMPTY_DATABASE = {
  meta: { packageSequence: 0 },
  officeSettings: [
    { code: "BUE", name: "Buea", isActive: true },
    { code: "LIM", name: "Limbe", isActive: true },
    { code: "DLA", name: "Douala", isActive: true }
  ],
  routeSettings: [
    { routeId: "BUE-LIM", origin: "BUE", destination: "LIM", name: "Buea to Limbe", basePriceCfa: 1500, isActive: true },
    { routeId: "LIM-BUE", origin: "LIM", destination: "BUE", name: "Limbe to Buea", basePriceCfa: 1500, isActive: true },
    { routeId: "BUE-DLA", origin: "BUE", destination: "DLA", name: "Buea to Douala", basePriceCfa: 3000, isActive: true },
    { routeId: "DLA-BUE", origin: "DLA", destination: "BUE", name: "Douala to Buea", basePriceCfa: 3000, isActive: true },
    { routeId: "LIM-DLA", origin: "LIM", destination: "DLA", name: "Limbe to Douala", basePriceCfa: 2500, isActive: true },
    { routeId: "DLA-LIM", origin: "DLA", destination: "LIM", name: "Douala to Limbe", basePriceCfa: 2500, isActive: true }
  ],
  users: [
    { userId: "admin", name: "Admin User", role: "ADMIN", office: "BUE", pin: "1234", isActive: true },
    { userId: "origin", name: "Origin Officer", role: "ORIGIN_OFFICER", office: "BUE", pin: "1234", isActive: true },
    { userId: "destination", name: "Destination Officer", role: "DESTINATION_OFFICER", office: "DLA", pin: "1234", isActive: true },
    { userId: "cashier", name: "Cashier", role: "CASHIER", office: "DLA", pin: "1234", isActive: true },
    { userId: "manifest", name: "Manifest Officer", role: "MANIFEST_OFFICER", office: "BUE", pin: "1234", isActive: true },
    { userId: "rider", name: "Pickup Rider", role: "RIDER", office: "BUE", pin: "1234", isActive: true },
    { userId: "auditor", name: "Viewer Auditor", role: "VIEWER_AUDITOR", office: "BUE", pin: "1234", isActive: true }
  ],
  bookings: [],
  pickupTasks: [],
  packages: [],
  vehicles: [],
  trips: [],
  manifests: [],
  collections: [],
  exceptions: [],
  payments: [],
  cashierShifts: [],
  cashClosings: [],
  events: [],
  auditLogs: []
};

export function createEmptyDatabase() {
  return structuredClone(EMPTY_DATABASE);
}

export function ensureDatabaseShape(database) {
  database.meta ||= { packageSequence: 0 };
  database.officeSettings ||= createEmptyDatabase().officeSettings;
  database.routeSettings ||= createEmptyDatabase().routeSettings;
  database.users ||= [];
  if (!database.users.length) database.users.push(...createEmptyDatabase().users);
  if (!database.users.some((user) => user.userId === "rider")) {
    database.users.push({ userId: "rider", name: "Pickup Rider", role: "RIDER", office: "BUE", pin: "1234", isActive: true });
  }
  database.bookings ||= [];
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

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensureDatabase();
  }

  ensureDatabase() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.write(createEmptyDatabase());
      return;
    }
    this.write(ensureDatabaseShape(this.read()));
  }

  read() {
    return ensureDatabaseShape(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
  }

  write(database) {
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(database, null, 2));
    fs.renameSync(temporaryPath, this.filePath);
  }

  transaction(callback) {
    const database = ensureDatabaseShape(this.read());
    const result = callback(database);
    this.write(database);
    return result;
  }
}

export class MemoryStore {
  constructor() {
    this.database = createEmptyDatabase();
  }

  read() {
    return ensureDatabaseShape(structuredClone(this.database));
  }

  transaction(callback) {
    const copy = ensureDatabaseShape(structuredClone(this.database));
    const result = callback(copy);
    this.database = copy;
    return result;
  }
}
