---
description: Deploy HTMW MCP Server to Raspberry Pi 3 B+ with Public URL
---

This workflow guides you through setting up your Raspberry Pi 3 B+, deploying the MCP server, keeping it running with PM2, and exposing it to `poke` using Cloudflare Tunnel.

## Prerequisites
-   Raspberry Pi 3 B+ (running Raspberry Pi OS / Raspbian)
-   Internet connection for the Pi
-   SSH access to the Pi (or a keyboard/monitor attached)

## Step 1: Prepare the Pi (SSH into Pi)

1.  **Update System**:
    ```bash
    sudo apt update && sudo apt upgrade -y
    ```

2.  **Install Node.js (v18 or v20)**:
    The Pi 3 B+ is ARMv8 (64-bit) or ARMv7. We'll use the official setup script.
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    ```
    *Verify:* `node -v` (Should be v20.x.x)

3.  **Install Git (Optional)** or just prepare a folder:
    ```bash
    mkdir -p ~/apps/htmw-mcp
    ```

## Step 2: Transfer Code (Run on Mac)

We need to copy your project from your Mac to the Pi. Replace `pi@raspberrypi.local` with your Pi's actual user/hostname.

1.  **Build the project locally first** (already done, but good to ensure):
    ```bash
    npm run build
    ```

2.  **Copy files using SCP**:
    *   Example assumes your Pi IP is `192.168.1.X` or hostname `raspberrypi.local`.
    ```bash
    # Run this from the project root on your Mac
    scp -r package.json package-lock.json dist src pi@raspberrypi.local:~/apps/htmw-mcp/
    ```

## Step 3: Install Dependencies on Pi (SSH into Pi)

1.  **Navigate to folder**:
    ```bash
    cd ~/apps/htmw-mcp
    ```

2.  **Install packages**:
    ```bash
    npm install --production
    ```
    *(Note: We use `--production` to skip dev dependencies since we already built the `dist` folder, but if you want to rebuild on Pi, just use `npm install` and transfer `tsconfig.json` too).*

## Step 4: Setup Process Manager (PM2)

We use PM2 to keep the server running in the background and restart it if it crashes or the Pi reboots.

1.  **Install PM2**:
    ```bash
    sudo npm install -g pm2
    ```

2.  **Start the Server**:
    Replace the environment variables with your actual credentials.
    ```bash
    HTMW_USERNAME='YOUR_USERNAME' HTMW_PASSWORD='YOUR_PASSWORD' pm2 start npm --name "htmw-mcp" -- run serve
    ```

3.  **Verify it's running**:
    ```bash
    pm2 logs htmw-mcp
    ```
    *You should see "MCP Server running on http://localhost:3000/sse"*

4.  **Save for Reboot**:
    ```bash
    pm2 save
    pm2 startup
    ```
    *(Run the command output by `pm2 startup` if prompted)*

## Step 5: Expose to Internet (Cloudflare Tunnel)

To verify the connection for Poke, we'll use a Cloudflare Quick Tunnel. This gives you a public HTTPS URL.

1.  **Install `cloudflared` on Pi**:
    ```bash
    # Choose 32-bit (armhf) or 64-bit (arm64) depending on your OS. Pi 3B+ supports 64-bit but default OS is often 32-bit.
    # Check with: uname -m (aarch64 is 64-bit, armv7l is 32-bit)
    
    # For 32-bit (armv7l):
    wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm -O cloudflared
    
    # For 64-bit (aarch64):
    wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -O cloudflared
    
    chmod +x cloudflared
    sudo mv cloudflared /usr/local/bin/
    ```

2.  **Run the Tunnel**:
    ```bash
    cloudflared tunnel --url http://localhost:3000
    ```

3.  **Get the URL**:
    Look for the output line: `+--------------------------------------------------------------------------------------------+`
    Inside you will see a URL like `https://funny-pigs-dance-loops.trycloudflare.com`.

4.  **Connect Poke**:
    *   **Server URL**: `https://<your-tunnel-subdomain>.trycloudflare.com/sse`
    *   **Name**: `HTMW Raspberry Pi`

## Step 6: Make Tunnel Persistent (Optional)

The quick tunnel URL changes every time you restart `cloudflared`. For a permanent URL, you need a Cloudflare account and a domain name (free setup).

If you just want it to stay up as long as the Pi is on without buying a domain:
Use **PageKite** or **Tailscale Funnel**, OR just keep the `cloudflared` command running in a `screen` session or PM2.

**Running cloudflared with PM2 (Quick Tunnel)**:
```bash
pm2 start cloudflared --name "tunnel" -- tunnel --url http://localhost:3000
pm2 save
```
*Check logs with `pm2 logs tunnel` to find your URL if the Pi reboots.*
