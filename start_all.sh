#!/bin/bash
# SIBOLTECH Complete System Startup Script
# Starts API + Firebase Sync (no tunnel needed - Firebase handles cloud access)

cd "$(dirname "$0")"
mkdir -p logs

echo "=========================================="
echo "  SIBOLTECH Sensor System Startup"
echo "=========================================="
echo ""

# Kill existing processes
echo "🔄 Stopping existing processes..."
pkill -f "python api.py" 2>/dev/null
pkill -f "firebase_sync.py" 2>/dev/null
sleep 2

# Activate virtual environment
source ~/sensor-venv/bin/activate

# Start Flask API
echo "🚀 Starting Flask API..."
nohup python api.py > logs/api.log 2>&1 &
echo $! > logs/api.pid
sleep 2

# Check API
if curl -s http://localhost:5000 > /dev/null; then
    echo "✅ API running on http://localhost:5000"
else
    echo "❌ API failed to start!"
    cat logs/api.log
    exit 1
fi

# Start Firebase Sync
echo "🔥 Starting Firebase Sync..."
nohup python firebase_sync.py > logs/firebase_sync.log 2>&1 &
echo $! > logs/firebase_sync.pid
sleep 2

if pgrep -f "firebase_sync.py" > /dev/null; then
    echo "✅ Firebase Sync running"
else
    echo "❌ Firebase Sync failed to start!"
fi

echo ""
echo "=========================================="
echo "  SIBOLTECH System Running!"
echo "=========================================="
echo ""
echo "Local Access:"
echo "  Dashboard: http://192.168.100.72:5000"
echo "  Mobile:    http://192.168.100.72:5000/mobile.html"
echo ""
echo "Cloud Access (via Firebase):"
echo "  Vercel:    https://siboltech-frontend.vercel.app"
echo ""
echo "To stop: pkill -f 'python api.py'; pkill -f 'firebase_sync.py'"
echo ""
