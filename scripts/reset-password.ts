import { DashboardDbSqlite } from "../src/dashboardDbSqlite.js";
import { cfg } from "../src/config.js";

const username = process.argv[2];
const newPass = process.argv[3];

if (!username || !newPass) {
  console.error("Usage: tsx scripts/reset-password.ts <username> <newPasscode>");
  process.exit(2);
}

const db = new DashboardDbSqlite({ sqlitePath: cfg.dashboard.sqlitePath, authSecret: cfg.dashboard.authSecret });
db.connect();
db.resetPassword(username, newPass);
db.close();
console.log(`Password reset for "${username}".`);

