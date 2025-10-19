
# PM2 Cheatsheet with Deep Theory & Practical Guide

This README serves both as a **hands-on cheatsheet** and a **detailed theory document** about PM2.  
It’s written for developers deploying Node.js apps (like MERN APIs) on Linux servers.

---

## 🌍 What is PM2?

PM2 (**Process Manager 2**) is a production-grade **process manager** for Node.js.  
Think of it as a supervisor that:

- Starts your app
- Keeps it running (auto-restart on crash)
- Distributes load across CPU cores (cluster mode)
- Provides logs, monitoring, and auto-start on reboot

Without PM2, you’d run `node server.js`, but if your terminal closes or the app crashes, it dies.  
PM2 ensures **high availability**.

---

## ⚙️ Why use PM2?

- **Resilience**: Auto restarts apps on crashes or server reboots  
- **Scalability**: Cluster mode uses all CPU cores efficiently  
- **Monitoring**: See CPU, RAM, logs in real time (`pm2 monit`)  
- **Automation**: Auto-start apps on boot with `systemd`  
- **Log Management**: Centralized log files + rotation (`pm2-logrotate`)  

In production, PM2 is almost always paired with **Nginx** as a reverse proxy.

---

## 🚀 Setup Steps

### 0. Install PM2 (once)

```bash
sudo npm i -g pm2
pm2 -v
```

---

### 1. Start an App

#### Basic start
```bash
pm2 start server.js --name mern-api
```

#### With environment variables (one-off)
```bash
PORT=5000 NODE_ENV=production pm2 start server.js --name mern-api
```

#### Cluster mode (multi-core, zero-downtime reload support)
```bash
pm2 start server.js --name mern-api -i max
```

#### Ecosystem file (best practice)
```bash
pm2 init
```

Edit `ecosystem.config.js`:
```js
module.exports = {
  apps: [{
    name: "mern-api",
    script: "server.js",
    instances: 1,             // or "max"
    exec_mode: "fork",        // or "cluster"
    env: { NODE_ENV: "development", PORT: 5000 },
    env_production: { NODE_ENV: "production", PORT: 5000 },
    max_memory_restart: "300M", // restart if RAM > 300MB
    watch: false,
    out_file: "~/.pm2/logs/mern-api-out.log",
    error_file: "~/.pm2/logs/mern-api-error.log",
    time: true
  }]
};
```

Run with:
```bash
pm2 start ecosystem.config.js --env production
```

---

### 2. Auto-start on Reboot (systemd)

```bash
pm2 save   # save current process list
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

PM2 will print a `sudo env PATH=... pm2 startup ...` command → run it once.

Verify:
```bash
systemctl status pm2-ubuntu
```

---

### 3. Daily Commands (Most Used)

```bash
pm2 list                       # see all apps
pm2 status mern-api            # details
pm2 logs mern-api --lines 100  # live logs
pm2 monit                      # TUI monitor (CPU, RAM, logs)
pm2 describe mern-api          # metadata (paths, env, etc.)

pm2 restart mern-api           # restart
pm2 reload mern-api            # zero-downtime (cluster)
pm2 stop mern-api              # stop
pm2 delete mern-api            # remove

pm2 save                       # persist state
pm2 resurrect                  # reload from last save
```

Common update workflow:
```bash
git pull && pm2 restart mern-api && pm2 save
```

---

### 4. Logs — Where & How

Default location:
```
~/.pm2/logs/
```

For app `mern-api`:
```
~/.pm2/logs/mern-api-out.log     # stdout
~/.pm2/logs/mern-api-error.log   # stderr
```

Other files:
```
~/.pm2/dump.pm2    # saved processes
~/.pm2/pm2.log     # PM2’s own log
~/.pm2/pids/       # PID files
```

#### Log rotation (prevent full disk)
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 60
pm2 restart pm2-logrotate
```

Maintenance:
```bash
pm2 flush
pm2 logs --raw
```

---

### 5. Health & Troubleshooting

```bash
pm2 logs mern-api --lines 200
pm2 describe mern-api
pm2 env 0   # env of pm_id 0 (from pm2 list)

pm2 restart mern-api --update-env
pm2 reset mern-api   # clear crash counters
```

---

### 6. Useful Options

```bash
pm2 start server.js --name mern-api --time
pm2 start server.js --name mern-api --max-memory-restart 300M
pm2 start server.js --name mern-api --watch    # dev only
pm2 start ecosystem.config.js --env production
```

---

### 7. Zero-downtime Reload (Cluster Mode)

```bash
pm2 start server.js -i max --name mern-api --exec_mode cluster
pm2 reload mern-api
```

---

### 8. Uninstall Cleanly

```bash
pm2 unstartup systemd -u ubuntu --hp /home/ubuntu
pm2 kill
sudo npm rm -g pm2
```

---

### 9. Safety Checklist (Production)

- Bind Node app to `127.0.0.1` (private), expose via **Nginx**  
- In AWS Security Group, do **not** open app ports (5000) to the internet  
- Always `pm2 save` after process changes  
- Use `pm2-logrotate` for logs  

---

## 🧠 Theory Recap

- **PM2 vs Node**: Node runs your app; PM2 supervises Node.  
- **Cluster Mode**: Enables horizontal scaling across CPU cores.  
- **Systemd Integration**: Ensures apps survive reboots.  
- **Log Rotation**: Prevents logs from eating storage.  
- **Best Practice**: PM2 + Nginx → secure, resilient architecture.

---
