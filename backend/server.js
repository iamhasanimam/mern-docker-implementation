import dotenv from 'dotenv';
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { randomUUID as uuid } from "node:crypto";
import accessLogger from "./access-logs.js";
import requestLog from "./request-logs.js";
dotenv.config()

async function start() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('mongodb connected');

  const Task = mongoose.model(
    "Task",
    new mongoose.Schema(
      {
        id: { type: String, unique: true, index: true, required: true },
        title: { type: String, required: true },
        done: { type: Boolean, default: false }
      },
      { timestamps: true, versionKey: false }
    )
  );

  const app = express();
  app.use(accessLogger);
  app.use(requestLog);

  const PORT = process.env.PORT || 5000;
 
  app.use(express.json());

  app.use("/", cors({
    origin: ["https://app.lauv.in", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders:["Content-Type", "Authorization"]
  }));
  
  
  app.get("/api/health", async (_req, res) => {
    try { await mongoose.connection.db.admin().ping();
      res.json({ ok: true, driver: "mongo", uptime: process.uptime() });
    } catch { res.status(500).json({ ok: false, driver: "mongo", uptime: process.uptime() }); }
  });

  app.get("/api/debug", (req, res)=>{
    res.json({
      ip:req.ip,
      headers:{
        host: req.headers["host"],
        "x-real-ip": req.headers["x-real-ip"],
        "x-forwarded-for": req.headers["x-forwarded-for"],
        "x-forwarded-proto": req.headers["x-forwarded-proto"]
      }
    });
  });

  app.post("/api/tasks", async (req, res) => {
    const title = req.body?.title?.trim();
    if (!title) return res.status(400).json({ error: "title required" });
    const task = await Task.create({ id: uuid(), title, done: !!req.body.done });
    res.status(201).json(task);
  });

  app.get("/api/tasks", async (_req, res) => {
    const items = await Task.find({}).sort({ createdAt: -1 }).lean();
    res.json(items);
  });

  app.put("/api/tasks/:id", async (req, res) => {
    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title.trim();
    if (req.body.done !== undefined) updates.done = !!req.body.done;

    const updated = await Task.findOneAndUpdate({ id: req.params.id }, updates, { new: true, lean: true });
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  });
  
  app.delete("/api/tasks/:id", async (req, res) => {
    const result = await Task.deleteOne({ id: req.params.id });
    if (result.deletedCount !== 1) return res.status(404).json({ error: "not found" });
    res.status(204).send();
  });

  app.listen(PORT,'0.0.0.0', () => console.log(`http://localhost:${PORT}`));
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

