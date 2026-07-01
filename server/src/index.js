import express from "express";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH, db } from "./db.js";
import { ensureBootstrapAdmin } from "./auth.js";
import { adminRouter } from "./routes/admin.js";
import { stationRouter } from "./routes/station.js";
import { syncRouter } from "./routes/sync.js";

ensureBootstrapAdmin();

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", adminRouter);
app.use("/api", stationRouter);
app.use("/api", syncRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Uventet serverfeil" });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`Løpstid-server kjører på :${port}`));

// ── Enkel roterende backup ──────────────────────────────────────────────────
// Kopierer SQLite-filen med jevne mellomrom. Første forsvarslinje mot disk-
// eller filsystemkorrupsjon; ikke en erstatning for ekte off-site backup, men
// billig å ha på plass fra dag én.
const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_BACKUPS = 30;

function backupOnce() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // SQLite WAL-modus: bruk backup-API-et fremfor filkopi for et konsistent øyeblikksbilde.
    db.backup(path.join(BACKUP_DIR, `lopstid-${stamp}.sqlite`))
      .then(() => {
        const files = fs
          .readdirSync(BACKUP_DIR)
          .filter((f) => f.endsWith(".sqlite"))
          .sort();
        while (files.length > MAX_BACKUPS) {
          fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
        }
      })
      .catch((err) => console.error("Backup feilet", err));
  } catch (err) {
    console.error("Backup feilet", err);
  }
}

backupOnce();
setInterval(backupOnce, BACKUP_INTERVAL_MS).unref();
