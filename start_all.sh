#!/bin/bash
# SIBOLTECH System Startup Script
# Run: ./start_all.sh

cd ~/Despro

echo "=========================================="
echo "  SIBOLTECH System Startup"
echo "=========================================="

# Activate virtual environment
source ~/sensor-venv/bin/activate 2>/dev/null || {
    echo "⚠️  Virtual environment not found, using system Python"
}

# Kill existing processes
echo "🔄 Stopping existing services..."
pkill -f "python api.py" 2>/dev/null
pkill -f "python3 api.py" 2>/dev/null
pkill -f cloudflared 2>/dev/null
sleep 1

# Create logs directory
mkdir -p logs

# Start API server
echo "🚀 Starting API server..."
python api.py > logs/api.log 2>&1 &
API_PID=$!
echo $API_PID > logs/api.pid
sleep 2

# Check if API started
if curl -s http://127.0.0.1:5000/api/latest > /dev/null 2>&1; then
    echo "✅ API server running on port 5000 (PID: $API_PID)"
else
    echo "❌ API failed to start! Check logs/api.log"
    exit 1
fi

# Start Cloudflare tunnel
echo "🌐 Starting Cloudflare tunnel..."
cloudflared tunnel --url http://127.0.0.1:5000 > logs/tunnel.log 2>&1 &
TUNNEL_PID=$!
echo $TUNNEL_PID > logs/tunnel.pid

# Wait for tunnel URL
echo "⏳ Waiting for tunnel URL..."
sleep 5

# Extract and save tunnel URL
TUNNEL_URL=$(grep -o 'https://[^"]*trycloudflare.com' logs/tunnel.log | head -1)
if [ -n "$TUNNEL_URL" ]; then
    echo "$TUNNEL_URL" > logs/tunnel_url.txt
    echo "✅ Tunnel running: $TUNNEL_URL"
else
    echo "⚠️  Tunnel URL not found yet. Check logs/tunnel.log"
    echo "   Run: grep -o 'https://.*trycloudflare.com' logs/tunnel.log"
fi

echo ""
echo "=========================================="
echo "  System Ready!"
echo "=========================================="
echo ""
echo "📡 Local API:    http://127.0.0.1:5000"
echo "🌐 Tunnel URL:   $TUNNEL_URL"
echo "📱 Mobile:       ${TUNNEL_URL}/mobile.html"
echo ""
echo "⚠️  IMPORTANT: Update the tunnel URL in:"
echo "   1. Vercel dashboard settings (gear icon)"
echo "   2. Mobile page settings (gear icon)"
echo ""
echo "📋 Logs:"
echo "   - API:    logs/api.log"
echo "   - Tunnel: logs/tunnel.log"
echo ""
