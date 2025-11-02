# MERN Stack AWS Deployment Guide

> A complete production-ready deployment guide for MERN applications on AWS with Docker, Nginx, and Application Load Balancer

[![AWS](https://img.shields.io/badge/AWS-Cloud-orange?logo=amazon-aws)](https://aws.amazon.com)
[![Docker](https://img.shields.io/badge/Docker-Containerized-blue?logo=docker)](https://www.docker.com)
[![Nginx](https://img.shields.io/badge/Nginx-Proxy-green?logo=nginx)](https://nginx.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green?logo=mongodb)](https://www.mongodb.com/cloud/atlas)

---

## Table of Contents

- [Architecture Overview](#-architecture-overview)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Deployment Phases](#-deployment-phases)
- [Verification Checklist](#-verification-checklist)
- [Troubleshooting](#-troubleshooting)
- [Learning Outcomes](#-learning-outcomes)

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

### Phase 2️: Request Correlation & Observability

**Goal:** Implement end-to-end request tracing.

<details>
<summary>Click to expand Phase 2</summary>

#### Add Request Logging Middleware

```javascript
// backend/middleware/requestLog.js
export default function requestLog(req, res, next) {
  const rid = req.headers['x-request-id'] || 'no-rid';
  const xff = req.headers['x-forwarded-for'] || req.ip;
  
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

// backend/server.js
import requestLog from './middleware/requestLog.js';
app.use(requestLog);
```

#### Testing Correlation

```bash
# Make request with custom header
curl -H "X-Test: correlation" http://localhost:8888/api/health

# Compare request IDs
docker compose exec proxy grep "correlation" /var/log/nginx/access_app.log | jq .req_id
docker compose logs backend1 | grep "correlation" | jq .requestId
# Both should show the same request ID
```

#### Success Criteria
- Same `X-Request-ID` appears in Nginx and backend logs
- JSON structured logs in both layers

</details>

---

### Phase 3️: AWS Network Foundation

**Goal:** Create secure VPC with public and private subnets.

<details>
<summary>Click to expand Phase 3</summary>

#### VPC Architecture

```
VPC: 10.0.0.0/16
├── Public Subnets (2 AZs)
│   ├── 10.0.1.0/24 (us-east-1a)
│   ├── 10.0.2.0/24 (us-east-1b)
│   └── Resources: ALB, NAT Gateway
└── Private Subnets (2 AZs)
    ├── 10.0.11.0/24 (us-east-1a)
    ├── 10.0.12.0/24 (us-east-1b)
    └── Resources: EC2 instances
```

#### Setup Steps

1. **Create VPC**
   - CIDR: `10.0.0.0/16`
   - Enable DNS hostnames
   - Enable DNS resolution

2. **Create Subnets**
   ```bash
   # Public subnets
   aws ec2 create-subnet --vpc-id vpc-xxx --cidr-block 10.0.1.0/24 --availability-zone us-east-1a
   aws ec2 create-subnet --vpc-id vpc-xxx --cidr-block 10.0.2.0/24 --availability-zone us-east-1b
   
   # Private subnets
   aws ec2 create-subnet --vpc-id vpc-xxx --cidr-block 10.0.11.0/24 --availability-zone us-east-1a
   aws ec2 create-subnet --vpc-id vpc-xxx --cidr-block 10.0.12.0/24 --availability-zone us-east-1b
   ```

3. **Create Internet Gateway**
   ```bash
   aws ec2 create-internet-gateway
   aws ec2 attach-internet-gateway --vpc-id vpc-xxx --internet-gateway-id igw-xxx
   ```

4. **Create NAT Gateway**
   ```bash
   # Allocate Elastic IP
   aws ec2 allocate-address --domain vpc
   
   # Create NAT Gateway in public subnet
   aws ec2 create-nat-gateway \
     --subnet-id subnet-public-xxx \
     --allocation-id eipalloc-xxx
   ```

5. **Configure Route Tables**
   ```bash
   # Public route table
   aws ec2 create-route --route-table-id rtb-public-xxx \
     --destination-cidr-block 0.0.0.0/0 \
     --gateway-id igw-xxx
   
   # Private route table
   aws ec2 create-route --route-table-id rtb-private-xxx \
     --destination-cidr-block 0.0.0.0/0 \
     --nat-gateway-id nat-xxx
   ```

6. **Create Security Groups**

   **ALB Security Group**
   ```bash
   # Inbound
   - HTTP (80) from 0.0.0.0/0
   - HTTPS (443) from 0.0.0.0/0
   
   # Outbound
   - 8888 to EC2-SG
   ```

   **EC2 Security Group**
   ```bash
   # Inbound
   - 8888 from ALB-SG only
   
   # Outbound
   - All traffic to 0.0.0.0/0 (for NAT access)
   ```

#### Success Criteria
- VPC has both Internet Gateway and NAT Gateway
- Public subnets route to IGW
- Private subnets route to NAT
- Security groups enforce least privilege

</details>

---

### Phase 4️: Private EC2 with Docker

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
set -euxo pipefail

# Update system
dnf update -y

# Install Docker
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user

# Install Docker Compose
COMPOSE_VERSION="v2.29.2"
curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Clone repository
mkdir -p /opt/mern
cd /opt/mern
git clone https://github.com/yourusername/your-repo.git .

# Set up environment (temporary - will use SSM in Phase 7)
cat > backend/.env << EOF
NODE_ENV=production
PORT=5000
MONGO_URI=${MONGO_URI}
EOF

# Start services
docker-compose up -d --build

# Verify
docker ps
curl -s http://localhost:8888/health
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

### Phase 5️: Application Load Balancer & TLS

**Goal:** Expose application securely via HTTPS.

<details>
<summary>Click to expand Phase 5</summary>

#### 1. Request ACM Certificate

```bash
aws acm request-certificate \
  --domain-name app.lauv.in \
  --validation-method DNS \
  --region us-east-1
```

Add DNS validation records to Route 53.

#### 2. Create Target Group

```bash
aws elbv2 create-target-group \
  --name mern-app-tg \
  --protocol HTTP \
  --port 8888 \
  --vpc-id vpc-xxx \
  --health-check-enabled \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3
```

#### 3. Create Application Load Balancer

```bash
aws elbv2 create-load-balancer \
  --name mern-app-alb \
  --subnets subnet-public-1-xxx subnet-public-2-xxx \
  --security-groups sg-alb-xxx \
  --scheme internet-facing \
  --type application
```

#### 4. Create Listeners

```bash
# HTTP → HTTPS Redirect
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:... \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}

# HTTPS → Target Group
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:... \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:... \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:...
```

#### 5. Register Target

```bash
aws elbv2 register-targets \
  --target-group-arn arn:aws:elasticloadbalancing:... \
  --targets Id=i-xxxxxxxxxxxxx
```

#### 6. Configure Route 53

```bash
# Create A record (ALIAS to ALB)
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "app.lauv.in",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z35SXDOTRQ7X7K",
          "DNSName": "mern-app-alb-123456789.us-east-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

#### Testing

```bash
# DNS propagation
dig +short app.lauv.in

# Test HTTP redirect
curl -I http://app.lauv.in

# Test HTTPS
curl -I https://app.lauv.in/health
curl -s https://app.lauv.in/api/health | jq

# Test TLS
openssl s_client -connect app.lauv.in:443 -servername app.lauv.in
```

#### Success Criteria
- DNS resolves to ALB
- HTTP redirects to HTTPS
- TLS certificate valid
- Both `/health` and `/api/health` return 200
- Target shows healthy in Target Group

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