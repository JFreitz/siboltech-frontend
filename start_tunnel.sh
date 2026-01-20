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

# Wait for URL to appear
sleep 8
TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | head -1)

if [ -n "$TUNNEL_URL" ]; then
    echo "$TUNNEL_URL" > logs/tunnel_url.txt
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
    echo "⚠️  URL changes on restart. Update ESP32 if needed."
    echo ""
else
    echo "❌ Could not get tunnel URL. Check logs/tunnel.log"
fi

echo "Press Ctrl+C to stop..."
wait $TUNNEL_PID
