#!/bin/bash
# SIBOLTECH Tunnel Startup Script
# Starts API + Cloudflare Quick Tunnel and saves the public URL

cd "$(dirname "$0")"
mkdir -p logs

# Kill any existing processes
pkill -f "cloudflared tunnel" 2>/dev/null
pkill -f "python api.py" 2>/dev/null
sleep 1

# Start Flask API
echo "🚀 Starting API server..."
source ~/sensor-venv/bin/activate
nohup python api.py > logs/api.log 2>&1 &
echo $! > logs/api.pid
sleep 2

# Check API
if curl -s http://localhost:5000 > /dev/null; then
    echo "✅ API running on http://localhost:5000"
else
    echo "❌ API failed to start!"
    exit 1
fi

# Start Cloudflare Quick Tunnel and capture URL
echo ""
echo "🌐 Starting Cloudflare Tunnel..."
cloudflared tunnel --url http://localhost:5000 2>&1 | tee logs/tunnel.log &
TUNNEL_PID=$!
echo $TUNNEL_PID > logs/tunnel.pid

# Wait for URL to appear (retry up to 30 seconds)
echo "⏳ Waiting for tunnel URL..."
TUNNEL_URL=""
for i in {1..30}; do
    TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | tail -1)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
    sleep 1
done

if [ -n "$TUNNEL_URL" ]; then
    echo "$TUNNEL_URL" > logs/tunnel_url.txt
    
    # Automatically update all hardcoded URLs in code files
    echo "🔄 Updating hardcoded URLs in code files..."
    find . -type f \( -name "*.js" -o -name "*.html" \) ! -path "./backup_*/*" ! -path "./.venv/*" ! -path "./node_modules/*" \
        -exec sed -i "s|https://[a-z0-9-]*\.trycloudflare\.com|$TUNNEL_URL|g" {} \;
    
    # Also update the esp32-bme280-usb copy
    if [ -d "../esp32-bme280-usb" ]; then
        find ../esp32-bme280-usb -type f \( -name "*.js" -o -name "*.html" \) ! -path "*/backup_*/*" ! -path "*/.venv/*" ! -path "*/node_modules/*" \
            -exec sed -i "s|https://[a-z0-9-]*\.trycloudflare\.com|$TUNNEL_URL|g" {} \;
    fi
    
    echo ""
    echo "=========================================="
    echo "✅ YOUR PUBLIC URL:"
    echo "   $TUNNEL_URL"
    echo "=========================================="
    echo ""
    echo "📱 Access from anywhere:"
    echo "   Dashboard: $TUNNEL_URL"
    echo "   Sensors:   $TUNNEL_URL/api/latest"
    echo "   Relays:    $TUNNEL_URL/api/relay/status"
    echo ""
    echo "✅ All code files updated automatically"
    echo ""
else
    echo "❌ Could not get tunnel URL. Check logs/tunnel.log"
fi

# Background URL monitor - updates file when tunnel reconnects
(
    while true; do
        sleep 60
        NEW_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | tail -1)
        if [ -n "$NEW_URL" ] && [ "$NEW_URL" != "$(cat logs/tunnel_url.txt 2>/dev/null)" ]; then
            echo "$NEW_URL" > logs/tunnel_url.txt
            echo "🔄 Tunnel URL updated: $NEW_URL"
        fi
    done
) &

echo "Press Ctrl+C to stop..."
wait $TUNNEL_PID
