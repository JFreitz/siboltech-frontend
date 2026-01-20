#!/bin/bash
# SIBOLTECH Self-Hosted Server Startup Script
# This starts the API and creates a Cloudflare tunnel for remote access

cd "$(dirname "$0")"

# Activate virtual environment
source ~/sensor-venv/bin/activate

# Kill any existing processes
pkill -f "python api.py" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null

# Start the Flask API in background
echo "🚀 Starting API server on port 5000..."
nohup python api.py > logs/api.log 2>&1 &
API_PID=$!
echo $API_PID > logs/api.pid
sleep 2

# Check if API started successfully
if curl -s http://localhost:5000 > /dev/null; then
    echo "✅ API running on http://localhost:5000"
else
    echo "❌ API failed to start. Check logs/api.log"
    exit 1
fi

# Start Cloudflare Tunnel (gives you a public URL)
echo ""
echo "🌐 Starting Cloudflare Tunnel..."
echo "   (This creates a public HTTPS URL for your API)"
echo ""

# Run tunnel - it will print the URL
cloudflared tunnel --url http://localhost:5000

# Note: When you Ctrl+C, the tunnel stops but API keeps running
# To stop API: kill $(cat logs/api.pid)
