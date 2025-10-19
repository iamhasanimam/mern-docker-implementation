# MERN App on AWS — Deployment Blueprint
---

<img src="./Architecture Diagram.png"/>

---

This repository documents, step by step, how I deployed a **MERN based application** on AWS following a **3-tier reference architecture** (Networking, Backend, Frontend).  
The goal is to demonstrate full-stack deployment capability, cloud infrastructure understanding, and production-grade practices.  

**Live endpoints:**  
- **Frontend (React):** [https://app.lauv.in](https://app.lauv.in)  
- **Backend (Express API):** [https://api.lauv.in](https://api.lauv.in)  

---

## Phase 1 — Foundation (Infrastructure + Networking)

This is where we establish the base AWS infrastructure before deploying any code.

### 1. VPC & Networking
- Created a **VPC** with CIDR `10.0.0.0/16`.  
  - Provides isolation for all cloud resources.  
- Created a **public subnet** `10.0.1.0/24`.  
  - Public subnet ensures the EC2 instance can be reached from the internet.  
- Configured a **Route Table** with:  
  - Local route to VPC CIDR (`10.0.0.0/16`).  
  - Internet route (`0.0.0.0/0`) pointing to an **Internet Gateway (IGW)**.  
- Attached an **Internet Gateway** to the VPC.  
  - Provides outbound and inbound internet access.  

### 2. Security Groups
- Created a Security Group for EC2:
  - **SSH (22)** → Only from my admin IP (secure remote login).  
  - **HTTP (80)** → Open to all (initial web traffic).  
  - **HTTPS (443)** → Open to all (secure traffic).  

### 3. EC2 Instance + Elastic IP
- Launched **Ubuntu EC2 instance** in the public subnet.  
- Allocated an **Elastic IP** and associated with the EC2.  
  - Static IP ensures DNS doesn’t break if instance restarts.  
- Verified SSH connectivity using:  
  ```bash
  ssh -i mykey.pem ubuntu@<Elastic_IP>
  ```

### 4. Route 53 DNS
- Created a **Route 53 Hosted Zone** for `lauv.in`.  
- Updated **registrar (GoDaddy)** nameservers to Route 53 NS.  
- Added A records:
  - `api.lauv.in` → Elastic IP (`23.21.22.150`).  

At this stage: `api.lauv.in` resolves to EC2 instance.

---

## Phase 1b — Backend Setup on EC2 (HTTPS + Reverse Proxy)

### Step 1: Update OS and Install Base Packages
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git ufw curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```
- **Why:** Secure, patched OS. Install Node.js runtime, process manager (PM2), and Nginx.  

### Step 2: Deploy the API Code
```bash
sudo mkdir -p /opt/mern-api
sudo chown -R ubuntu:ubuntu /opt/mern-api
cd /opt/mern-api

git clone <YOUR_REPO_URL> .
cd backend
npm ci
```
- `.env` file created with sensitive secrets:  
```bash
cat > .env <<'EOF'
PORT=5000
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>
EOF
```

### Step 3: Run API with PM2
```bash
pm2 start server.js --name mern-api --env production
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```
- **Why PM2:** Keeps process alive, auto-restarts on crash/reboot.  

### Step 4: Configure Nginx as Reverse Proxy
Created `/etc/nginx/sites-available/api.conf`:
```nginx
server {
  listen 80;
  server_name api.lauv.in;
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name api.lauv.in;

  # SSL certs injected by Certbot

  location /api/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```
Then enabled:
```bash
sudo ln -s /etc/nginx/sites-available/api.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Step 5: Install TLS Certificates with Let’s Encrypt
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.lauv.in
```
- Certificates auto-installed at `/etc/letsencrypt/live/api.lauv.in/`  
- Auto-renew setup:
```bash
echo "0 3 * * * root certbot renew --quiet" | sudo tee /etc/cron.d/certbot_renew
```

Now: [https://api.lauv.in/api/health](https://api.lauv.in/api/health) secured.

---

## Phase 2 — Frontend Hosting (S3 + CloudFront)

### Step 1: Prepare React Build
```bash
cd frontend
export REACT_APP_API_BASE=https://api.lauv.in
npm ci
npm run build
```

### Step 2: Create S3 Bucket
- Bucket: `app.lauv.in`  
- Enabled Block Public Access.  
- Versioning turned on.  

### Step 3: Request ACM Certificate (N. Virginia)
- Requested certificate for `app.lauv.in`.  
- Validated via DNS in Route 53.  
- Status: **Issued**.  

### Step 4: Create CloudFront Distribution
- Origin: S3 bucket (private).  
- Enabled **Origin Access Control (OAC)**.  
- Alternate domain: `app.lauv.in`.  
- Viewer policy: Redirect HTTP → HTTPS.  
- TLS cert: ACM issued earlier.  
- Custom error responses for React SPA (403/404 → `/index.html`).  

### Step 5: Update Route 53
- Created **Alias A record**:  
  `app.lauv.in` → CloudFront distribution.  

### Step 6: Upload React Build & Invalidate Cache
```bash
aws s3 sync build/ s3://app.lauv.in/ --delete
aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
```

Now: [https://app.lauv.in](https://app.lauv.in) is live.

---

## Phase 3 — Operations & Monitoring

1. **CloudWatch Alarms**  
   - CPU utilization > 80% for 5 min → SNS alert.  
   - Status check failed → SNS alert.  

2. **EC2 Backups**  
   - Daily AMI snapshots with **Data Lifecycle Manager**.  

3. **MongoDB Atlas Monitoring**  
   - Metrics for query performance and active connections.  

---

## Final Architecture Diagram

```
Users
 ├─► https://app.lauv.in  → CloudFront (TLS) → S3 (React build via OAC)
 └─► https://api.lauv.in  → EC2 (Nginx TLS) → Node/Express → MongoDB Atlas (TLS)
```
---

**Live Demo Links**  
- Frontend: [https://app.lauv.in](https://app.lauv.in)  
- Backend: [https://api.lauv.in](https://api.lauv.in)  
