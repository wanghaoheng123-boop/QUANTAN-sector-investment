# Alibaba ECS Auto Deploy (GitHub Actions)

This project includes a workflow at `.github/workflows/ecs-deploy.yml` that deploys to Alibaba Cloud ECS on every push to `main`.

## 1) Prepare your ECS server (one time)

Use Ubuntu 22.04+ (recommended).

```bash
sudo apt update
sudo apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Clone your repository:

```bash
mkdir -p ~/apps
cd ~/apps
git clone <YOUR_GITHUB_REPO_URL> quantan
cd quantan
npm ci
npm run build
```

Create your production env file:

```bash
cp .env.example .env.production
# edit .env.production with real values
```

Load env values globally for PM2 startup:

```bash
set -a
source .env.production
set +a
pm2 startOrReload ecosystem.config.js --env production
pm2 save
pm2 startup
```

## 2) Configure Nginx reverse proxy

Create `/etc/nginx/sites-available/quantan`:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_ECS_PUBLIC_IP;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/quantan /etc/nginx/sites-enabled/quantan
sudo nginx -t
sudo systemctl restart nginx
```

## 3) Add GitHub Actions secrets

GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret:

- `ECS_HOST`: ECS public IP or domain.
- `ECS_USER`: SSH user (for example `ubuntu`).
- `ECS_SSH_PORT`: usually `22`.
- `ECS_SSH_PRIVATE_KEY`: private key content (OpenSSH format).
- `ECS_APP_DIR`: absolute path on ECS, for example `/home/ubuntu/apps/quantan`.

## 4) Deploy flow

1. Push to `main`.
2. GitHub Actions SSHs to ECS.
3. Server runs:
   - `git pull --ff-only origin main`
   - `npm ci`
   - `npm run build`
   - `pm2 startOrReload ecosystem.config.js --env production`

## 5) Optional hardening (recommended)

- Restrict ECS security group inbound:
  - `80/443` from internet
  - `22` only from your office/home IP
- Use a dedicated deploy user instead of root.
- Set up TLS with Certbot:
  - `sudo apt install -y certbot python3-certbot-nginx`
  - `sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com`
