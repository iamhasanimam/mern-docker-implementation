# MERN Stack AWS Deployment Guide

> A complete production-ready deployment guide for MERN applications on AWS with Docker, Nginx, and Application Load Balancer

[![AWS](https://img.shields.io/badge/AWS-Cloud-orange?logo=amazon-aws)](https://aws.amazon.com)
[![Docker](https://img.shields.io/badge/Docker-Containerized-blue?logo=docker)](https://www.docker.com)
[![Nginx](https://img.shields.io/badge/Nginx-Proxy-green?logo=nginx)](https://nginx.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green?logo=mongodb)](https://www.mongodb.com/cloud/atlas)

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Deployment Phases](#deployment-phases)
- [Verification Checklist](#verification-checklist)
- [Troubleshooting](#troubleshooting)
- [Learning Outcomes](#learning-outcomes)

---

## Architecture Overview
![alt text](Mern-Docker-Architecture.png)

<!-- ```
User (HTTPS) → Route 53 → ALB (TLS/ACM) 
                            ↓
                    Private EC2 Instance
                            ↓
                    Nginx Reverse Proxy
                       ↙        ↘
            Frontend ×2      Backend ×2
                                ↓
                          MongoDB Atlas
``` -->

### Key Components

| Component | Purpose | Network |
|-----------|---------|---------|
| **Route 53** | DNS management | Public |
| **ALB** | Load balancing + TLS termination | Public subnets |
| **EC2** | Docker host | Private subnet |
| **Nginx** | Reverse proxy + load balancing | Container network |
| **Frontend** | React apps (2 instances) | Container network |
| **Backend** | Node.js APIs (2 instances) | Container network |
| **MongoDB Atlas** | Managed database | Cloud |
| **CloudWatch** | Logs + metrics + alarms | AWS Service |

---

## Prerequisites

### Local Environment
- [ ] Docker & Docker Compose installed
- [ ] Node.js 18+ (for local testing)
- [ ] Git configured
- [ ] AWS CLI configured with credentials

### AWS Account Setup
- [ ] Active AWS account with billing enabled
- [ ] IAM user with appropriate permissions
- [ ] MongoDB Atlas account with cluster ready
- [ ] Domain registered (or using Route 53)

### Required IAM Permissions
```
- EC2 (full)
- VPC (full)
- ELB (full)
- Route53 (full)
- ACM (full)
- SSM (read/write parameters)
- CloudWatch (logs, metrics, alarms)
```

---

## Quick Start

### 1. Clone and Setup

```bash
# Clone your repository
git clone https://github.com/yourusername/your-mern-app.git
cd your-mern-app

# Create environment file
cat > backend/.env << EOF
NODE_ENV=production
PORT=5000
MONGO_URI=your_mongodb_atlas_connection_string
EOF
```

### 2. Test Locally

```bash
# Start all services
docker compose up -d --build

# Verify services are running
docker ps

# Test endpoints
curl http://localhost:8888/health          # Should return: ok
curl http://localhost:8888/api/health      # Should return: {"ok":true}

# Check logs
docker compose logs -f proxy
docker compose logs -f backend1
```

### 3. View the Setup

```bash
# See container networking
docker network inspect your-project_app_net

# Check Nginx load balancing
for i in {1..6}; do curl -s localhost:8888/api/health; done
```

---

## Deployment Phases

### Phase 0️: Baseline & Repository Setup

**Goal:** Ensure your application runs correctly before adding infrastructure complexity.

<details>
<summary>Click to expand Phase 0</summary>

#### Tasks

1. **Verify Backend Health Endpoint**
   ```javascript
   // backend/server.js
   app.get('/api/health', (req, res) => {
     res.json({ ok: true, timestamp: new Date().toISOString() });
   });
   ```

2. **Check Server Binding**
   ```javascript
   // Must bind to 0.0.0.0, not 127.0.0.1
   app.listen(PORT, '0.0.0.0', () => {
     console.log(`Server running on port ${PORT}`);
   });
   ```

3. **Test Locally**
   ```bash
   cd backend
   npm install
   node server.js &
   curl http://localhost:5000/api/health
   ```

####  Success Criteria
- Health endpoint returns 200 OK
- Server binds to 0.0.0.0
- MongoDB connection works

</details>

---

### Phase 1️: Local Docker Setup

**Goal:** Mirror production environment locally with Docker Compose.

<details>
<summary>Click to expand Phase 1</summary>

#### Docker Compose Configuration

Your current `docker-compose.yml` is already set up correctly:

```yaml
version: "3.9"
networks:
  app_net:
    driver: bridge

volumes:
  nginx_logs:
  api_logs:

services:
  proxy:
    image: nginx:alpine
    container_name: nginx_proxy
    ports:
      - "8888:8888"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - nginx_logs:/var/log/nginx
    depends_on:
      - frontend1
      - frontend2
      - backend1
      - backend2
    networks:
      - app_net

  frontend1:
    build: ./frontend
    container_name: fe1
    expose:
      - 80
    networks:
      - app_net

  frontend2:
    build: ./frontend
    container_name: fe2
    expose:
      - 80
    networks:
      - app_net

  backend1:
    build: ./backend
    container_name: backend-api-1
    expose:
      - 5000
    volumes:
      - api_logs:/usr/src/app/logs
    env_file:
      - ./backend/.env
    networks:
      - app_net

  backend2:
    build: ./backend
    container_name: backend-api-2
    expose:
      - 5000
    volumes:
      - api_logs:/usr/src/app/logs
    env_file:
      - ./backend/.env
    networks:
      - app_net
```

#### Key Points
- Only `proxy` exposes port 8888 to host
- Frontend and backend use `expose` (internal only)
- All services on shared `app_net` bridge network
- Logs are persisted via Docker volumes

#### Nginx Configuration

See your `nginx.conf` for the complete reverse proxy setup with:
- Round-robin load balancing
- JSON access logs with request ID correlation
- Security headers
- Health check endpoint at `/health`

#### Testing

```bash
# Start everything
docker compose up -d --build

# Verify all containers are running
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Test health endpoints
curl -v http://localhost:8888/health
curl -v http://localhost:8888/api/health

# Test load balancing (watch container logs)
for i in {1..10}; do 
  curl -s http://localhost:8888/api/health | jq
  sleep 1
done

# Check logs
docker compose logs proxy | tail -20
docker compose exec proxy cat /var/log/nginx/access_app.log | jq
```

#### Success Criteria
- All 5 containers running
- Both health endpoints return 200
- Round-robin visible in logs
- Request IDs present in logs

</details>

---

###  Phase 2: Request Correlation & Log Matching

**Goal:** Trace one request from Nginx → Backend using a shared `X-Request-ID`.

<details>
<summary>Click to expand Phase 2</summary>

## Why it matters

In production, debugging without correlation IDs = guesswork. Correlation IDs let you:
- Trace one request across logs
- Debug latency & failures
- Observe proxy → service flow

## Step 1: Backend Middleware

**File:** `backend/request-logs.js`

```javascript
export default function requestLog(req, res, next) {
  const rid = req.headers['x-request-id'] || 'no-rid';
  const xff = req.headers['x-forwarded-for'] || req.ip;

  req.id = rid; // attach for future logs/errors

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    requestId: rid,
    ip: xff,
    method: req.method,
    path: req.originalUrl,
    userAgent: req.headers['user-agent']
  }));

  next();
}
```

**File:** `backend/server.js`

```javascript
import requestLog from './request-log.js';
app.use(requestLog);
```

## Step 2: Nginx Headers

In `location /api/` & `/` blocks ensure:

```nginx
proxy_set_header X-Request-ID $reqid;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

And enable JSON logging:

```nginx
access_log /var/log/nginx/access_app.log json;
```

## Step 3: Trigger Request

```bash
curl -I http://localhost:8888/api/health
```

## Step 4: Verify Logs

Scroll and locate the `requestId` that matches the curl request.

### Nginx (enter container and read log file)

```bash
docker compose exec proxy sh
cd /var/log/nginx
cat access_app.log
```

Search for the same `req_id` in this file.

### Backend (view container logs)

```bash
docker compose logs backend1 backend2 | grep f3da8b9048e0dfae0ca8346720c73dd5
```

**If both match — correlation succeeded!**

## Example Output

### Backend Log

```json
{
  "timestamp": "2025-11-04T10:47:26.512Z",
  "requestId": "f3da8b9048e0dfae0ca8346720c73dd5",
  "ip": "172.21.0.1",
  "method": "GET",
  "path": "/api/health",
  "userAgent": "curl/8.14.1"
}
```

### Nginx Log

```json
{
  "time": "04/Nov/2025:10:47:26 +0000",
  "ip": "172.21.0.1",
  "method": "GET",
  "uri": "/api/health",
  "status": 200,
  "bytes": 50,
  "user_agent": "curl/8.14.1",
  "xff": "172.21.0.1",
  "req_id": "f3da8b9048e0dfae0ca8346720c73dd5",
  "upstream": "172.21.0.4:5000",
  "rt": "0.173",
  "urt": "0.172"
}
```

### Same Request ID = Correlation Success

`f3da8b9048e0dfae0ca8346720c73dd5` appears in both layers

## Result

You now have real distributed tracing:
- Request IDs passed edge → backend
- JSON structured logs
- Proof of correlation verified

</details>

---

### Phase 3: AWS VPC Network Foundation

**Goal:** Create a secure VPC with public and private subnets to host ALB, NAT Gateway, and EC2/ECS workloads.

<details>
<summary>Click to expand Phase 3</summary>

## Overview

This phase establishes the network foundation for a production-grade AWS infrastructure. The VPC architecture implements network isolation with public subnets for internet-facing resources and private subnets for application workloads.

**Key components:**
- Public subnet for Application Load Balancer and NAT Gateway
- Private subnet for EC2 instances and future ECS tasks
- Internet Gateway for public subnet connectivity
- NAT Gateway for private subnet outbound access
- Route tables enforcing traffic segmentation
- Security groups implementing least-privilege access

---

## Architecture

```
VPC: 10.0.0.0/16
│
├── Public Subnet (10.0.1.0/24 - us-east-1a)
│   ├── Internet Gateway
│   ├── Application Load Balancer
│   └── NAT Gateway
│
└── Private Subnet (10.0.2.0/24 - us-east-1a)
    └── EC2 Instances (Application Tier)
```

**Design principles:**
- Single Availability Zone deployment (expandable to multi-AZ)
- Private subnet instances have no direct internet access
- All outbound traffic from private subnet routes through NAT Gateway
- Public subnet hosts only load balancers and NAT devices

---

## Implementation

### Step 1: Create VPC

Create a VPC with sufficient address space for current and future subnets.

**Configuration:**
- CIDR Block: `10.0.0.0/16`
- Enable DNS Hostnames: Yes
- Enable DNS Resolution: Yes

```bash
aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --enable-dns-hostnames \
  --enable-dns-support
```

---

### Step 2: Create Subnets

Create one public and one private subnet in the same availability zone.

#### Public Subnet
- CIDR: `10.0.1.0/24`
- Availability Zone: `us-east-1a`
- Auto-assign Public IPv4: Disabled (explicit EIP allocation)

#### Private Subnet
- CIDR: `10.0.2.0/24`
- Availability Zone: `us-east-1a`
- Auto-assign Public IPv4: Disabled

```bash
# Create public subnet
aws ec2 create-subnet \
  --vpc-id vpc-xxxxxxxxx \
  --cidr-block 10.0.1.0/24 \
  --availability-zone us-east-1a

# Create private subnet
aws ec2 create-subnet \
  --vpc-id vpc-xxxxxxxxx \
  --cidr-block 10.0.2.0/24 \
  --availability-zone us-east-1a
```

---

### Step 3: Create and Attach Internet Gateway

The Internet Gateway enables communication between the VPC and the internet.

```bash
# Create Internet Gateway
aws ec2 create-internet-gateway

# Attach to VPC
aws ec2 attach-internet-gateway \
  --vpc-id vpc-xxxxxxxxx \
  --internet-gateway-id igw-xxxxxxxxx
```

---

### Step 4: Create NAT Gateway

The NAT Gateway allows instances in private subnets to access the internet for updates and external API calls while remaining unreachable from the internet.

**Prerequisites:**
- NAT Gateway must be deployed in the public subnet
- Requires an Elastic IP address

```bash
# Allocate Elastic IP
aws ec2 allocate-address --domain vpc

# Create NAT Gateway in public subnet
aws ec2 create-nat-gateway \
  --subnet-id subnet-public-xxxxxxxxx \
  --allocation-id eipalloc-xxxxxxxxx
```

**Note:** NAT Gateway provisioning takes 5-10 minutes. Verify status before updating route tables.

---

### Step 5: Configure Route Tables

#### Public Route Table

The public route table directs internet-bound traffic to the Internet Gateway.

| Destination | Target | Purpose |
|------------|--------|---------|
| `10.0.0.0/16` | local | Intra-VPC communication |
| `0.0.0.0/0` | Internet Gateway | Internet access |

```bash
# Create route to Internet Gateway
aws ec2 create-route \
  --route-table-id rtb-public-xxxxxxxxx \
  --destination-cidr-block 0.0.0.0/0 \
  --gateway-id igw-xxxxxxxxx

# Associate with public subnet
aws ec2 associate-route-table \
  --route-table-id rtb-public-xxxxxxxxx \
  --subnet-id subnet-public-xxxxxxxxx
```

#### Private Route Table

The private route table directs internet-bound traffic through the NAT Gateway.

| Destination | Target | Purpose |
|------------|--------|---------|
| `10.0.0.0/16` | local | Intra-VPC communication |
| `0.0.0.0/0` | NAT Gateway | Outbound internet access |

```bash
# Create route to NAT Gateway
aws ec2 create-route \
  --route-table-id rtb-private-xxxxxxxxx \
  --destination-cidr-block 0.0.0.0/0 \
  --nat-gateway-id nat-xxxxxxxxx

# Associate with private subnet
aws ec2 associate-route-table \
  --route-table-id rtb-private-xxxxxxxxx \
  --subnet-id subnet-private-xxxxxxxxx
```

---

### Step 6: Configure Security Groups

#### ALB Security Group

Controls inbound traffic to the Application Load Balancer.

**Inbound Rules:**
- HTTP (80) from `0.0.0.0/0`
- HTTPS (443) from `0.0.0.0/0`

**Outbound Rules:**
- Port 8888 to EC2 Security Group

```bash
aws ec2 create-security-group \
  --group-name alb-sg \
  --description "Security group for Application Load Balancer" \
  --vpc-id vpc-xxxxxxxxx

aws ec2 authorize-security-group-ingress \
  --group-id sg-alb-xxxxxxxxx \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-id sg-alb-xxxxxxxxx \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0
```

#### EC2 Security Group

Controls traffic to EC2 instances in the private subnet.

**Inbound Rules:**
- Port 8888 from ALB Security Group only

**Outbound Rules:**
- All traffic to `0.0.0.0/0` (via NAT Gateway)

```bash
aws ec2 create-security-group \
  --group-name ec2-app-sg \
  --description "Security group for application EC2 instances" \
  --vpc-id vpc-xxxxxxxxx

aws ec2 authorize-security-group-ingress \
  --group-id sg-ec2-xxxxxxxxx \
  --protocol tcp \
  --port 8888 \
  --source-group sg-alb-xxxxxxxxx
```

---

## Verification

### Validate VPC Configuration

```bash
# Verify VPC
aws ec2 describe-vpcs --vpc-ids vpc-xxxxxxxxx

# Verify subnets
aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-xxxxxxxxx"

# Verify Internet Gateway
aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=vpc-xxxxxxxxx"

# Verify NAT Gateway
aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=vpc-xxxxxxxxx"
```

### Test Connectivity

1. Launch a test EC2 instance in the private subnet
2. Verify outbound internet access through NAT Gateway
3. Confirm instance is not directly accessible from the internet
4. Validate security group rules are enforcing proper access control

---

## Success Criteria

- VPC created with DNS resolution enabled
- Public subnet with route to Internet Gateway
- Private subnet with route to NAT Gateway
- Internet Gateway attached to VPC
- NAT Gateway operational in public subnet
- Security groups enforce least-privilege access
- Private instances cannot receive inbound traffic from internet
- Private instances can initiate outbound connections via NAT

---

## Cost Considerations

**NAT Gateway:** Charged per hour and per GB of data processed. Consider these optimizations:

- Use NAT Gateway instead of NAT instances for production
- Monitor data transfer costs through CloudWatch
- Consider VPC endpoints for AWS service access to reduce NAT costs

**Estimated monthly cost for single NAT Gateway in us-east-1:**
- Hourly charge: ~$32/month
- Data processing: $0.045 per GB

---

## Multi-AZ Expansion

To extend this architecture across multiple availability zones:

1. Create additional subnets in us-east-1b:
   - Public: `10.0.11.0/24`
   - Private: `10.0.12.0/24`

2. Deploy second NAT Gateway in us-east-1b public subnet

3. Create separate route table for us-east-1b private subnet

4. Update ALB to span both availability zones

---

</details>

---

### Phase 4: Private EC2 with Docker

**Goal:** Launch EC2 in private subnet, accessible only via AWS Systems Manager.

<details>
<summary>Click to expand Phase 4</summary>

#### IAM Role Setup

Create role with these policies:
- `AmazonSSMManagedInstanceCore`
- `CloudWatchAgentServerPolicy`

#### User Data Script

```bash
#!/bin/bash
set -euo pipefail

# --- Config you must set before running ---
: "${MONGO_URI:?Set MONGO_URI in the environment before running this script}"

# Optional: If your default user isn't 'ubuntu', change this.
DEFAULT_USER="ubuntu"

export DEBIAN_FRONTEND=noninteractive

# Update system
sudo apt-get update -y
sudo apt-get upgrade -y

# Install Docker (from Ubuntu repo) + Compose v2 plugin + git + curl
sudo apt-get install -y docker.io docker-compose-plugin git curl

# Enable & start Docker
sudo systemctl enable --now docker

# Add user to docker group so you can run docker without sudo
if id -u "${DEFAULT_USER}" >/dev/null 2>&1; then
  sudo usermod -aG docker "${DEFAULT_USER}"
fi

# Create app folder and clone repository
sudo mkdir -p /opt/mern
sudo chown -R "${DEFAULT_USER}:${DEFAULT_USER}" /opt/mern
cd /opt/mern

# If you already cloned once and are re-running, pull latest; else clone fresh
if [ -d .git ]; then
  git pull --rebase
else
  git clone https://github.com/yourusername/your-repo.git .
fi

# Write backend env (temporary — move to SSM later)
mkdir -p backend
cat > backend/.env <<EOF
NODE_ENV=production
PORT=5000
MONGO_URI=${MONGO_URI}
EOF

# Build & start with Compose v2 (note the space: 'docker compose')
sudo docker compose up -d --build

# Verify
sudo docker ps
curl -sf http://localhost:8888/health || true

echo "Done. If you just added ${DEFAULT_USER} to the docker group, log out and back in (or 'newgrp docker') to use 'docker' without sudo."

```

#### Launch EC2

```bash
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \  # Amazon Linux 2023
  --instance-type t3.medium \
  --subnet-id subnet-private-xxx \
  --security-group-ids sg-ec2-xxx \
  --iam-instance-profile Name=EC2-SSM-Role \
  --user-data file://user-data.sh \
  --no-associate-public-ip-address \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=MERN-App-Server}]'
```

#### Connect via Session Manager

```bash
# List instances
aws ssm describe-instance-information

# Connect
aws ssm start-session --target i-xxxxxxxxxxxxx

# Once connected, verify
sudo su - ec2-user
cd /opt/mern
docker ps
curl localhost:8888/health
```

#### Success Criteria
- EC2 has NO public IP
- Accessible via Session Manager
- All Docker containers running
- Health checks pass internally

</details>

---

### # Phase 5: Application Load Balancer & TLS Setup

**Goal**: Get `https://app.lauv.in` working securely with a real SSL certificate

<details>
<summary>Click to expand Phase 5</summary>

**What You'll Do**:
- Request a free SSL certificate from AWS
- Create a Target Group (think of it as a "pool" of servers)
- Set up an Application Load Balancer (the traffic director)
- Point your domain to the load balancer

**Time Needed**: 30-45 minutes (mostly waiting for DNS propagation)

---

## Step 1: Request Your SSL Certificate (ACM)

SSL certificates make the little padlock appear in browsers. AWS gives them for free.

### 1.1 Open Certificate Manager
1. Log into **AWS Console**
2. Search for **"Certificate Manager"** in the top search bar
3. Click on **AWS Certificate Manager**
4. **IMPORTANT**: Check top-right corner - switch region to **US East (N. Virginia)** if your ALB is there
   - ACM certificate MUST be in the same region as your ALB

### 1.2 Request Certificate
1. Click the orange **"Request"** button (or "Request a certificate")
2. Choose **"Request a public certificate"** and click **Next**

### 1.3 Configure Domain
1. **Domain name**: Type `app.lauv.in`
   - Don't add `https://` or `www.`
   - Just the bare domain
2. Click **Add another name to this certificate** if you want `www.app.lauv.in` too (optional)
3. **Validation method**: Select **DNS validation**
   - This is easier and automatic
4. **Key algorithm**: Leave as **RSA 2048** (default)
5. Click **Request**

### 1.4 Validate Your Domain
AWS needs to verify you own the domain:

1. You'll see a page saying "Pending validation"
2. Click on your certificate ARN (looks like `arn:aws:acm:us-east-1:...`)
3. Scroll down to **Domains** section
4. Click **Create records in Route 53** button (orange button)
   - If you don't see this button, your domain must be in Route 53 first
5. A modal appears - click **Create records**
6. Wait 5-10 minutes - status will change from "Pending" to **"Issued"**

**Take a break** - Go grab coffee while DNS propagates

---

## Step 2: Create Target Group

Think of this as creating a "basket" where you'll put your EC2 instance. The ALB will send traffic to this basket.

### 2.1 Navigate to Target Groups
1. Search for **"EC2"** in AWS Console
2. In the left sidebar, scroll down to **Load Balancing** section
3. Click **Target Groups**

### 2.2 Create New Target Group
1. Click **Create target group** (blue button, top-right)

### 2.3 Basic Configuration
**Step 1: Specify group details**

1. **Choose a target type**:
   - Select **Instances** (first option)
   
2. **Target group name**: Type `mern-app-tg`
   - Use something descriptive
   
3. **Protocol**: Select **HTTP**
   
4. **Port**: Type `8888`
   - This is the port Nginx listens on in your EC2

5. **VPC**: Select your VPC (the one where your EC2 lives)

6. **Protocol version**: Leave as **HTTP1** (default)

### 2.4 Health Check Settings
Scroll down to **Health checks** section:

1. **Health check protocol**: HTTP (already selected)

2. **Health check path**: Type `/health`
   - This endpoint returns 200 OK in your app

3. Click **Advanced health check settings** to expand:
   - **Healthy threshold**: `2` (how many checks must pass)
   - **Unhealthy threshold**: `3` (how many must fail)
   - **Timeout**: `5` seconds
   - **Interval**: `30` seconds
   - **Success codes**: Type `200`

4. Click **Next** (bottom-right)

### 2.5 Register Targets
**Step 2: Register targets**

1. Find your EC2 instance in the list
2. **Select the checkbox** next to your instance
3. Click **Include as pending below** button
4. You'll see your instance appear in "Review targets" section below
5. Click **Create target group** (blue button)

**Success!** You'll see "Successfully created target group"

**Wait 1-2 minutes** then refresh - status should become **Healthy**

---

## Step 3: Create Application Load Balancer

This is the main event - the traffic director for your app.

### 3.1 Navigate to Load Balancers
1. In EC2 Console sidebar (left), under **Load Balancing**
2. Click **Load Balancers**

### 3.2 Create Load Balancer
1. Click **Create Load Balancer** (orange button)
2. You'll see 4 types - select **Application Load Balancer**
3. Click **Create** under ALB card

### 3.3 Basic Configuration
**Step 1: Configure Load Balancer**

1. **Load balancer name**: Type `mern-app-alb`

2. **Scheme**: Select **Internet-facing**
   - Your app needs to be accessible from the internet

3. **IP address type**: Select **IPv4**

### 3.4 Network Mapping
Scroll to **Network mapping**:

1. **VPC**: Select your VPC

2. **Mappings**: 
   - Check **at least 2 Availability Zones**
   - For each AZ, select your **PUBLIC subnets**
   - Why public? ALB needs internet access to receive traffic

Example:
```
[X] us-east-1a → subnet-public-1
[X] us-east-1b → subnet-public-2
```

### 3.5 Security Groups
1. Click **Create new security group** (opens new tab)

**In the new tab:**

1. **Security group name**: `mern-alb-sg`
2. **Description**: "Allow HTTPS and HTTP for ALB"
3. **VPC**: Select your VPC

**Inbound rules** - Click "Add rule" twice:

| Type  | Protocol | Port | Source    | Description |
|-------|----------|------|-----------|-------------|
| HTTP  | TCP      | 80   | 0.0.0.0/0 | Allow HTTP  |
| HTTPS | TCP      | 443  | 0.0.0.0/0 | Allow HTTPS |

4. Click **Create security group**
5. Copy the **Security Group ID** (sg-xxxxx)
6. **Go back to ALB tab**
7. Click the refresh icon next to Security Groups dropdown
8. Select your new `mern-alb-sg`

### 3.6 Listeners and Routing
Scroll to **Listeners and routing**:

You'll see a default listener:
- **Protocol**: HTTP
- **Port**: 80

1. **Default action**: Select your target group `mern-app-tg` from dropdown

2. Click **Add listener** button

**For the new listener:**
- **Protocol**: Select **HTTPS**
- **Port**: `443`
- **Default action**: Select `mern-app-tg`

3. Scroll down to **Secure listener settings**
   - **Security policy**: Leave default (ELBSecurityPolicy-2016-08)
   - **Default SSL/TLS certificate**: Select **From ACM**
   - Choose your certificate `app.lauv.in` from dropdown

### 3.7 Create ALB
1. Scroll to bottom
2. Click **Create load balancer** (orange button)
3. Success message appears

**Wait 3-5 minutes** - Status will change from "Provisioning" to **"Active"**

### 3.8 Copy ALB DNS Name
1. Click on your ALB name `mern-app-alb`
2. In the **Description** tab, find **DNS name**
3. Copy it - looks like: `mern-app-alb-123456789.us-east-1.elb.amazonaws.com`

---

## Step 4: Set Up HTTP to HTTPS Redirect

Right now, HTTP (port 80) goes to your target. Let's make it redirect to HTTPS instead.

### 4.1 Edit HTTP Listener
1. Still in your ALB details page
2. Click **Listeners** tab
3. Find the **HTTP:80** listener
4. Select the checkbox
5. Click **Actions** dropdown and select **Edit listener**

### 4.2 Configure Redirect
1. Delete the existing "Forward to" action:
   - Find the action row
   - Click the trash icon

2. Click **Add action** dropdown and select **Redirect to URL**

3. Fill in:
   - **Protocol**: `HTTPS`
   - **Port**: `443`
   - **Status code**: `301 - Permanently moved`

4. Click **Save changes**

Now all HTTP traffic auto-redirects to HTTPS.

---

## Step 5: Update Security Groups

Your EC2's security group needs to allow traffic from the ALB.

### 5.1 Find Your EC2 Security Group
1. Go to **EC2 Console** and click **Instances**
2. Click your instance
3. Click **Security** tab
4. Click on the Security Group name (opens SG page)

### 5.2 Add Inbound Rule
1. Click **Edit inbound rules**
2. Click **Add rule**

Fill in:
- **Type**: Custom TCP
- **Port range**: `8888`
- **Source**: Click the dropdown and choose **Custom**
  - Start typing your ALB security group ID (`sg-xxxxx`)
  - Select it from dropdown
- **Description**: "Allow traffic from ALB"

3. Click **Save rules**

---

## Step 6: Point Domain to ALB (Route 53)

Final step - tell the world where `app.lauv.in` lives.

### 6.1 Open Route 53
1. Search for **"Route 53"** in AWS Console
2. Click **Hosted zones** (left sidebar)
3. Click on your domain `lauv.in`

### 6.2 Create A Record
1. Click **Create record** (orange button)

**Quick create method:**
1. **Record name**: Type `app`
   - This creates `app.lauv.in`

2. **Record type**: Select **A - Routes traffic to IPv4**

3. **Toggle ON** the switch: **Alias** (important!)

4. **Route traffic to**:
   - Select **Alias to Application and Classic Load Balancer**
   - **Region**: Choose your ALB's region (e.g., US East N. Virginia)
   - **Load balancer**: Select your ALB from dropdown
     - Should show `dualstack.mern-app-alb-...`

5. **Routing policy**: Simple routing (default)

6. **Evaluate target health**: Toggle **ON**

7. Click **Create records**

---

## Step 7: Testing & Verification

### 7.1 Wait for DNS Propagation
This takes **5-15 minutes**. Be patient.

Check DNS:
1. Open **Command Prompt** (Windows) or **Terminal** (Mac/Linux)
2. Type: `nslookup app.lauv.in`
3. You should see your ALB's IP addresses

### 7.2 Test HTTP Redirect
1. Open browser
2. Visit: `http://app.lauv.in` (without 's')
3. URL should auto-change to `https://app.lauv.in`
4. You should see a padlock in the address bar

### 7.3 Test Application
Try these URLs in your browser:

- `https://app.lauv.in/health` - Should return "OK" or 200
- `https://app.lauv.in/api/health` - Should return JSON: `{"ok": true}`
- `https://app.lauv.in/` - Your frontend should load

### 7.4 Check Target Health
1. Go back to **EC2 Console** and click **Target Groups**
2. Click `mern-app-tg`
3. Click **Targets** tab
4. Your instance should show **Healthy**

**If Unhealthy:**
- Check your EC2's security group (allows port 8888 from ALB?)
- SSH into EC2: `docker ps` - are containers running?
- Check logs: `docker logs mern_proxy_1`

---

## Success Checklist

- [ ] ACM certificate shows **"Issued"** status
- [ ] Target Group shows instance as **"Healthy"**
- [ ] ALB status is **"Active"**
- [ ] HTTP listener redirects to HTTPS
- [ ] HTTPS listener has ACM certificate attached
- [ ] DNS resolves: `nslookup app.lauv.in` returns IPs
- [ ] Browser shows padlock at `https://app.lauv.in`
- [ ] `/health` returns 200 OK
- [ ] `/api/health` returns JSON
- [ ] Frontend loads at root path `/`

---

## Common Issues & Fixes

### Problem: "502 Bad Gateway"
**Cause**: ALB can't reach your EC2

**Fix**:
1. Check Target Group health (is it "Unhealthy"?)
2. Verify EC2 security group allows port 8888 from ALB's security group
3. SSH to EC2: `docker ps` - are containers running?
4. Check: `curl localhost:8888/health` - does it respond?

### Problem: "Certificate pending validation"
**Cause**: DNS records not created

**Fix**:
1. Go to ACM and click certificate
2. Click "Create records in Route 53" again
3. Wait 10 minutes and refresh

### Problem: "DNS_PROBE_FINISHED_NXDOMAIN"
**Cause**: DNS not propagated yet

**Fix**:
1. Wait 15-30 minutes
2. Clear browser cache (Ctrl+Shift+Delete)
3. Try: `nslookup app.lauv.in` - do you see IPs?

### Problem: "Cannot select certificate in ALB listener"
**Cause**: Certificate in wrong region

**Fix**:
1. Check ALB region (top-right of console)
2. Go to ACM - switch to SAME region
3. Request certificate again in correct region

### Problem: "Connection timeout"
**Cause**: ALB in wrong subnets

**Fix**:
1. Edit ALB and go to Network mapping
2. Ensure you selected **public subnets** (with Internet Gateway route)
3. Check ALB's security group allows 80/443 from internet (0.0.0.0/0)

---

## What You Just Built

```
Internet
   ↓
Route 53 (app.lauv.in)
   ↓
Application Load Balancer
   ↓ (HTTPS terminated here)
Target Group (HTTP)
   ↓ (port 8888)
EC2 Instance
   ↓
Docker (Nginx Proxy)
   ↓
Backend Containers
```

**Key Achievements**:
- Free SSL certificate (no more "Not Secure" warnings)
- Automatic HTTP to HTTPS redirect
- Health checks (ALB only sends traffic to healthy servers)
- Production-ready domain setup
- Foundation for scaling (can add more instances to target group)

---

</details>

---

### Phase 6️: MongoDB Atlas Security

**Goal:** Lock down database access to only your infrastructure.

<details>
<summary>Click to expand Phase 6</summary>

#### Get NAT Gateway Public IP

```bash
aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=vpc-xxx" \
  --query 'NatGateways[0].NatGatewayAddresses[0].PublicIp' \
  --output text
```

#### Configure Atlas Network Access

1. Log into MongoDB Atlas
2. Navigate to **Network Access**
3. Click **Add IP Address**
4. Enter your NAT Gateway EIP
5. Add description: "Production NAT Gateway"
6. Save

#### Test Connection

```bash
# From EC2 (via Session Manager)
curl -s https://app.lauv.in/api/health

# Check backend logs for MongoDB connection
docker logs backend-api-1 | grep -i mongo
```

#### Verify Restriction

```bash
# Temporarily remove the IP allowlist entry in Atlas
# Then test - should fail
curl -s https://app.lauv.in/api/health
# Should show database connection error

# Re-add the IP - should recover
```

####  Success Criteria
- Only NAT Gateway IP allowed in Atlas
- Connection works from EC2
- Connection fails when IP removed
- No public access to database

</details>

---

### Phase 7️: Secrets Management with SSM

**Goal:** Remove hardcoded secrets from repository.

<details>
<summary>Click to expand Phase 7</summary>

#### Store Secret in SSM

```bash
aws ssm put-parameter \
  --name "/mern/prod/MONGO_URI" \
  --type "SecureString" \
  --value "mongodb+srv://user:pass@cluster.mongodb.net/dbname?retryWrites=true&w=majority" \
  --description "Production MongoDB connection string" \
  --overwrite
```

#### Update IAM Role

Add policy to EC2 instance role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": "arn:aws:ssm:us-east-1:*:parameter/mern/prod/*"
    }
  ]
}
```

#### Create Deployment Script

```bash
#!/bin/bash
# /opt/mern/deploy.sh

set -euo pipefail

echo "Fetching secrets from SSM..."
MONGO_URI=$(aws ssm get-parameter \
  --name "/mern/prod/MONGO_URI" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text \
  --region us-east-1)

echo "Updating environment file..."
cat > /opt/mern/backend/.env << EOF
NODE_ENV=production
PORT=5000
MONGO_URI=${MONGO_URI}
EOF

echo "Restarting services..."
cd /opt/mern
docker-compose down
docker-compose up -d --build

echo "Waiting for services to be healthy..."
sleep 10

echo "Verifying health..."
curl -f http://localhost:8888/health && echo "✓ Proxy healthy"
curl -f http://localhost:8888/api/health && echo "✓ API healthy"

echo "Deployment complete!"
```

#### Make it executable

```bash
chmod +x /opt/mern/deploy.sh
```

#### Test Deployment

```bash
# Connect via Session Manager
aws ssm start-session --target i-xxxxxxxxxxxxx

# Run deployment script
sudo /opt/mern/deploy.sh
```

#### Remove from Git

```bash
# Add to .gitignore
echo "backend/.env" >> .gitignore

# Remove tracked file
git rm --cached backend/.env
git commit -m "Remove secrets from repository"
git push
```

#### Success Criteria
- No `.env` file in repository
- Secrets stored in SSM Parameter Store
- Deployment script fetches secrets successfully
- Application healthy after deploy

</details>

---

### Phase 8️: CloudWatch Observability

**Goal:** Centralized logging, metrics, and alerting.

<details>
<summary>Click to expand Phase 8</summary>

#### Install CloudWatch Agent

```bash
# Connect to EC2
aws ssm start-session --target i-xxxxxxxxxxxxx

# Install agent
sudo rpm -Uvh https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
```

#### Configure Agent

```bash
sudo tee /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json > /dev/null << 'EOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/lib/docker/volumes/mern_nginx_logs/_data/access_app.log",
            "log_group_name": "/mern/prod/nginx/access",
            "log_stream_name": "{instance_id}",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/lib/docker/volumes/mern_api_logs/_data/*.log",
            "log_group_name": "/mern/prod/api",
            "log_stream_name": "{instance_id}",
            "timezone": "UTC"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "MERN/Application",
    "metrics_collected": {
      "mem": {
        "measurement": [
          {"name": "mem_used_percent", "rename": "MemoryUsedPercent"}
        ],
        "metrics_collection_interval": 60
      },
      "disk": {
        "measurement": [
          {"name": "used_percent", "rename": "DiskUsedPercent"}
        ],
        "metrics_collection_interval": 60,
        "resources": ["*"]
      }
    },
    "append_dimensions": {
      "InstanceId": "${aws:InstanceId}"
    }
  }
}
EOF
```

#### Start Agent

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \
  -s
```

#### Create CloudWatch Alarms

```bash
# High 5xx errors
aws cloudwatch put-metric-alarm \
  --alarm-name mern-alb-5xx-errors \
  --alarm-description "Alert on 5xx errors from ALB" \
  --metric-name HTTPCode_ELB_5XX_Count \
  --namespace AWS/ApplicationELB \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=LoadBalancer,Value=app/mern-app-alb/xxxxx

# High response time
aws cloudwatch put-metric-alarm \
  --alarm-name mern-high-latency \
  --alarm-description "Alert on high response time" \
  --metric-name TargetResponseTime \
  --namespace AWS/ApplicationELB \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 1.0 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=LoadBalancer,Value=app/mern-app-alb/xxxxx

# Unhealthy targets
aws cloudwatch put-metric-alarm \
  --alarm-name mern-unhealthy-targets \
  --alarm-description "Alert when targets become unhealthy" \
  --metric-name UnHealthyHostCount \
  --namespace AWS/ApplicationELB \
  --statistic Average \
  --period 60 \
  --evaluation-periods 1 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=TargetGroup,Value=targetgroup/mern-app-tg/xxxxx
```

#### Query Logs

```bash
# Install CloudWatch Logs Insights CLI helper
pip install awslogs

# Tail Nginx logs
awslogs get /mern/prod/nginx/access --watch

# Query API errors
aws logs filter-log-events \
  --log-group-name /mern/prod/api \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000
```

#### Success Criteria
- Logs streaming to CloudWatch
- Metrics visible in CloudWatch dashboard
- Alarms configured and testing
- Can query logs effectively

</details>

---

### Phase 9️: CloudFront CDN (Optional)

**Goal:** Add CDN for static assets and edge caching.

<details>
<summary>Click to expand Phase 9</summary>

#### When to Use CloudFront

 **Use CloudFront if:**
- Global user base needs low latency
- Heavy static asset delivery
- Want DDoS protection (AWS Shield)
- Need geo-restriction
- Want to reduce ALB bandwidth costs

 **Skip CloudFront if:**
- Regional application only
- Mostly dynamic/API content
- Tight budget
- Simple architecture preferred

#### Setup Steps

1. **Request Certificate in us-east-1**
   ```bash
   aws acm request-certificate \
     --domain-name app.lauv.in \
     --validation-method DNS \
     --region us-east-1
   ```

2. **Create Distribution**
   - Origin: Your ALB DNS name
   - Protocol: HTTPS only
   - Viewer Protocol: Redirect HTTP to HTTPS

3. **Configure Cache Behaviors**
   ```
   /* (Default behavior)
   - Cache policy: CachingOptimized
   - Origin request policy: AllViewer
   
   /api/* (Custom behavior)
   - Cache policy: CachingDisabled
   - Origin request policy: AllViewerExceptHostHeader
   ```

4. **Update Route 53**
   ```bash
   # Change A record to point to CloudFront
   aws route53 change-resource-record-sets \
     --hosted-zone-id Z1234567890ABC \
     --change-batch file://cloudfront-alias.json
   ```

####  Success Criteria
- CloudFront distribution deployed
- Static assets cached at edge
- API requests bypass cache
- Improved global latency

</details>

---

### Phase 10: Blue/Green Deployments

**Goal:** Zero-downtime deployments using multiple target groups.

<details>
<summary>Click to expand Phase 10</summary>

#### Strategy

```
Current (Blue): proxy:8888 → TG-Blue → ALB Listener
New (Green): proxy:8889 → TG-Green → Not yet live

Deploy → Test → Switch Listener → Decomm Blue
```

#### Modified Compose for Green

```yaml
# docker-compose.green.yml
version: "3.9"
services:
  proxy:
    ports:
      - "8889:8888"  # Different host port
    # ... rest same
```

#### Deployment Script

```bash
#!/bin/bash
# /opt/mern/blue-green-deploy.sh

set -euo pipefail

GREEN_PORT=8889
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d' ' -f2)
ALB_TG_BLUE="arn:aws:elasticloadbalancing:..."
ALB_TG_GREEN="arn:aws:elasticloadbalancing:..."
LISTENER_ARN="arn:aws:elasticloadbalancing:..."

echo "1. Starting Green deployment on port ${GREEN_PORT}..."
cd /opt/mern
docker-compose -p green -f docker-compose.green.yml up -d --build

echo "2. Waiting for Green to be healthy..."
sleep 30
if ! curl -f http://localhost:${GREEN_PORT}/health; then
  echo "Green health check failed!"
  exit 1
fi

echo "3. Registering Green target..."
aws elbv2 register-targets \
  --target-group-arn ${ALB_TG_GREEN} \
  --targets Id=${INSTANCE_ID},Port=${GREEN_PORT}

echo "4. Waiting for Green target to become healthy..."
for i in {1..20}; do
  HEALTH=$(aws elbv2 describe-target-health \
    --target-group-arn ${ALB_TG_GREEN} \
    --targets Id=${INSTANCE_ID},Port=${GREEN_PORT} \
    --query 'TargetHealthDescriptions[0].TargetHealth.State' \
    --output text)
  
  if [ "$HEALTH" = "healthy" ]; then
    echo "✓ Green is healthy!"
    break
  fi
  echo "Waiting... (${HEALTH})"
  sleep 15
done

if [ "$HEALTH" != "healthy" ]; then
  echo "Green failed to become healthy!"
  exit 1
fi

echo "5. Switching ALB listener to Green..."
aws elbv2 modify-listener \
  --listener-arn ${LISTENER_ARN} \
  --default-actions Type=forward,TargetGroupArn=${ALB_TG_GREEN}

echo "6. Waiting 60 seconds for in-flight requests to drain..."
sleep 60

echo "7. Deregistering and stopping Blue..."
aws elbv2 deregister-targets \
  --target-group-arn ${ALB_TG_BLUE} \
  --targets Id=${INSTANCE_ID},Port=8888

docker-compose -p default down

echo "✓ Blue/Green deployment complete!"
```

#### Continuous Testing During Switch

```bash
# Run this in a separate terminal during deployment
hey -z 120s -c 10 https://app.lauv.in/api/health
```

#### Success Criteria
- Zero failed requests during switch
- Green environment fully functional
- Old Blue environment cleaned up
- Rollback plan tested

</details>

---

## Verification Checklist

Use this checklist to ensure each phase is complete:

### Local Development
- [ ] `docker compose up -d` starts all services successfully
- [ ] Only port 8888 exposed on host
- [ ] `/health` returns 200 OK
- [ ] `/api/health` returns `{"ok":true}`
- [ ] Round-robin load balancing visible in logs
- [ ] Request ID correlation works end-to-end

### AWS Infrastructure
- [ ] VPC has public and private subnets in 2 AZs
- [ ] NAT Gateway provides outbound internet for private subnets
- [ ] Security groups enforce least-privilege access
- [ ] EC2 instance has NO public IP address
- [ ] Can connect to EC2 via AWS Systems Manager only

### Application Layer
- [ ] ALB listener on port 443 with valid ACM certificate
- [ ] Target Group shows "healthy" status
- [ ] `https://app.lauv.in` resolves and loads correctly
- [ ] Both `/` and `/api/*` routes work through ALB
- [ ] HTTP automatically redirects to HTTPS

### Database & Secrets
- [ ] MongoDB Atlas allowlist contains only NAT Gateway EIP
- [ ] Connection fails when EIP removed (tested and restored)
- [ ] No `.env` files committed to repository
- [ ] Secrets stored in SSM Parameter Store
- [ ] Deployment script successfully fetches secrets

### Observability
- [ ] CloudWatch Agent running on EC2
- [ ] Nginx access logs streaming to CloudWatch
- [ ] API application logs streaming to CloudWatch
- [ ] ALB metrics visible in CloudWatch dashboard
- [ ] Alarms configured and tested (5xx errors, latency, unhealthy targets)
- [ ] Can query logs using CloudWatch Logs Insights

### Optional Enhancements
- [ ] CloudFront distribution created (if needed)
- [ ] Blue/Green deployment process documented and tested
- [ ] Rollback procedure validated

---

## Troubleshooting

### Common Issues & Solutions

<details>
<summary><strong>502 Bad Gateway from ALB</strong></summary>

**Symptoms:** ALB returns 502, target shows unhealthy

**Possible Causes:**
1. Target not responding on port 8888
2. Security group blocking ALB → EC2:8888
3. Health check path mismatch
4. Container not running

**Debug Steps:**
```bash
# Check target health
aws elbv2 describe-target-health --target-group-arn arn:aws:...

# Connect to EC2 via Session Manager
aws ssm start-session --target i-xxxxxxxxxxxxx

# Test locally on EC2
curl -v http://localhost:8888/health

# Check containers
docker ps
docker logs nginx_proxy
docker logs backend-api-1

# Verify security groups
aws ec2 describe-security-groups --group-ids sg-xxx
```

**Solution:**
- Ensure `/health` endpoint returns 200
- Verify security group allows ALB-SG → EC2-SG:8888
- Check Docker containers are running

</details>

<details>
<summary><strong>MongoDB Connection Failures</strong></summary>

**Symptoms:** API health check fails, logs show MongoDB connection errors

**Possible Causes:**
1. NAT Gateway EIP not in Atlas allowlist
2. Wrong MONGO_URI
3. Network connectivity issues

**Debug Steps:**
```bash
# Check NAT Gateway public IP
aws ec2 describe-nat-gateways --query 'NatGateways[*].NatGatewayAddresses[*].PublicIp'

# Test from EC2
docker exec backend-api-1 printenv MONGO_URI

# Check backend logs
docker logs backend-api-1 | grep -i mongo
```

**Solution:**
- Add NAT EIP to Atlas Network Access
- Verify MONGO_URI format and credentials
- Check Atlas cluster is running

</details>

<details>
<summary><strong>CORS Errors in Browser</strong></summary>

**Symptoms:** API calls from frontend fail with CORS policy errors

**Possible Causes:**
1. Backend not configured for CORS
2. Wrong origin in CORS settings
3. Missing headers in Nginx proxy

**Debug Steps:**
```bash
# Test OPTIONS request
curl -X OPTIONS https://app.lauv.in/api/users \
  -H "Origin: https://app.lauv.in" \
  -H "Access-Control-Request-Method: POST" \
  -v
```

**Solution:**
```javascript
// backend/server.js
import cors from 'cors';

app.use(cors({
  origin: 'https://app.lauv.in',
  credentials: true
}));
```

</details>

<details>
<summary><strong>CloudWatch Logs Not Appearing</strong></summary>

**Symptoms:** No logs in CloudWatch despite agent running

**Possible Causes:**
1. Wrong file paths in agent config
2. Missing IAM permissions
3. Agent not running

**Debug Steps:**
```bash
# Check agent status
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a query -m ec2 -c default

# Check agent logs
sudo cat /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log

# Verify file paths exist
ls -la /var/lib/docker/volumes/mern_nginx_logs/_data/
```

**Solution:**
- Verify Docker volume paths match agent config
- Ensure IAM role has CloudWatchAgentServerPolicy
- Restart agent after config changes

</details>

<details>
<summary><strong>ACM Certificate Not Selectable</strong></summary>

**Symptoms:** Certificate exists but not available in ALB/CloudFront

**Possible Causes:**
1. Certificate in wrong region
2. Certificate not validated
3. Domain mismatch

**Debug Steps:**
```bash
# List certificates by region
aws acm list-certificates --region us-east-1
aws acm list-certificates --region us-east-2

# Check certificate status
aws acm describe-certificate --certificate-arn arn:aws:acm:...
```

**Solution:**
- For ALB: Certificate must be in same region as ALB
- For CloudFront: Certificate must be in us-east-1
- Complete DNS validation in Route 53

</details>

<details>
<summary><strong>Container Networking Issues</strong></summary>

**Symptoms:** Containers can't reach each other, DNS resolution fails

**Possible Causes:**
1. Services not on same Docker network
2. Wrong service names in proxy config
3. Using `ports` instead of `expose`

**Debug Steps:**
```bash
# Inspect network
docker network inspect mern_app_net

# Test DNS resolution
docker exec nginx_proxy nslookup backend1

# Check container connectivity
docker exec nginx_proxy wget -O- http://backend1:5000/api/health
```

**Solution:**
- Ensure all services use `networks: [app_net]`
- Use service names (not localhost) in nginx.conf
- Backend containers should use `expose`, not `ports`

</details>

---

## Learning Outcomes

By completing this deployment, you'll gain hands-on experience with:

### AWS Services
| Service | What You'll Learn |
|---------|-------------------|
| **VPC** | Subnet design, routing, NAT, Internet Gateways |
| **EC2** | Instance management, user data, IAM roles |
| **ALB** | Layer 7 load balancing, target groups, health checks |
| **Route 53** | DNS management, ALIAS records |
| **ACM** | TLS certificate management, validation |
| **SSM** | Parameter Store, Session Manager, secrets management |
| **CloudWatch** | Logs, metrics, alarms, dashboards |
| **Security Groups** | Network security, least-privilege design |

### Infrastructure Concepts
- **Network Design:** Public vs private subnets, NAT for egress
- **Load Balancing:** Round-robin, health checks, target groups
- **TLS/SSL:** Certificate management, HTTPS enforcement
- **Security:** Defense in depth, zero-trust, IAM least privilege
- **Observability:** Centralized logging, metrics, alerting
- **High Availability:** Multi-AZ design, redundancy

### Docker & Containerization
- **Networking:** User-defined bridges, service discovery
- **Compose:** Multi-container orchestration, dependencies
- **Volumes:** Persistent data, log management
- **Best Practices:** Expose vs ports, layer caching, multi-stage builds

### DevOps Practices
- **Infrastructure as Code:** Repeatable deployments
- **Secrets Management:** Secure credential handling
- **Monitoring:** Proactive alerting, troubleshooting
- **Deployment Strategies:** Blue/green, zero-downtime releases

### Nginx
- **Reverse Proxy:** Path-based routing, upstream configuration
- **Load Balancing:** Round-robin, health monitoring
- **Request Tracing:** Header forwarding, correlation IDs
- **Security:** Headers, timeouts, rate limiting

---

##  Next Steps

### Immediate Improvements
1. **Automate with Terraform/CloudFormation**
   - Version control your infrastructure
   - Enable team collaboration
   - Simplify multi-environment deployments

2. **Set Up CI/CD Pipeline**
   - GitHub Actions or AWS CodePipeline
   - Automated testing on push
   - Automatic deployments to staging

3. **Implement Auto Scaling**
   - Auto Scaling Group for EC2 instances
   - Scale based on CPU/memory/request count
   - Cost optimization

4. **Add Database Backups**
   - Automated MongoDB Atlas backups
   - Point-in-time recovery
   - Backup testing procedures

### Production Hardening
- [ ] Enable AWS WAF on ALB
- [ ] Implement rate limiting
- [ ] Add DDoS protection (Shield Standard/Advanced)
- [ ] Set up VPC Flow Logs
- [ ] Enable AWS Config for compliance
- [ ] Implement log retention policies
- [ ] Create disaster recovery runbook
- [ ] Set up multi-region failover

### Cost Optimization
- [ ] Right-size EC2 instances
- [ ] Use Reserved Instances or Savings Plans
- [ ] Implement CloudFront for bandwidth reduction
- [ ] Set up cost anomaly alerts
- [ ] Review and remove unused resources

---

## Additional Resources

### Official Documentation
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [MongoDB Atlas](https://docs.atlas.mongodb.com/)

### Community Resources
- [AWS Architecture Center](https://aws.amazon.com/architecture/)
- [Docker Hub](https://hub.docker.com/)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/aws)

---

<div align="center">

**⭐ If this guide helped you, please star the repository! ⭐**

Made with ❤️ for the DevOps community

</div>
