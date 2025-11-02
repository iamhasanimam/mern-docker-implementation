// backend/accesslogs.js
import fs from "fs";
import path from "path";

const LOG_DIR = "/usr/src/app/logs";
const ACCESS_LOG = path.join(LOG_DIR, "access.log");

// ensure folder exists
fs.mkdirSync(LOG_DIR, { recursive: true });

export default function accessLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    // proxy-aware client IP (works with/without nginx)
    const clientIp =
      (req.headers["x-forwarded-for"]?.split(",")[0] || "").trim() ||
      req.socket?.remoteAddress ||
      "unknown";

    const line = `${new Date().toISOString()} ${clientIp} ${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${durationMs.toFixed(1)}ms\n`;

    // fs.appendFile(ACCESS_LOG, line, () => {});
    fs.appendFile(ACCESS_LOG, line, (err) => {
  if (err) console.error("access log write failed:", err.message);
  });

  });

  next();
}
